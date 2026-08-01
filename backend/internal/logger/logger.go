// Package logger provides a small wrapper around log/slog so the rest of the
// codebase can log without threading a *slog.Logger around and without caring
// whether Init has been called yet.
package logger

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// logger holds the active *slog.Logger. It is an atomic pointer because Init
// (which writes it) races with the LogX helpers (which read it from every
// request goroutine); a plain package var would be a data race under -race.
var (
	logger atomic.Pointer[slog.Logger]
	once   sync.Once
	sink   atomic.Pointer[alertSinkHolder]
)

// AlertEvent is the immutable, stringified snapshot of an error-level log
// record handed to an asynchronous alert sink. Stringifying at the logging
// boundary prevents later mutation of an arbitrary slog.Any value from
// changing what the notifier eventually sends.
type AlertEvent struct {
	Time    time.Time
	Level   slog.Level
	Message string
	Attrs   map[string]string
}

// AlertSink receives error-level records asynchronously. Implementations must
// return quickly and must not log an error through this package, or they could
// recursively enqueue their own delivery failures.
type AlertSink interface {
	Enqueue(AlertEvent)
}

type alertSinkHolder struct{ sink AlertSink }

// Init initializes the global logger. It's safe to call more than once; only
// the first call takes effect. If it's never called, LogInfo/LogError/etc.
// will lazily initialize with defaults on first use.
//
// Output is always stdout: in containers this is the Right Thing™ because the
// orchestrator captures stdout and routes it to the log aggregator. Writing
// to a file from inside the container fights that.
func Init() {
	once.Do(func() {
		level := parseLevel(os.Getenv("LOG_LEVEL"))
		handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level:     level,
			AddSource: level <= slog.LevelDebug,
		})
		l := slog.New(&contextHandler{Handler: &alertHandler{Handler: handler}})
		logger.Store(l)
		// Route the stdlib default through the same handler so library code
		// (and packages that must not import this one) logs consistently.
		slog.SetDefault(l)
	})
}

// SetAlertSink attaches the optional asynchronous error sink. It is safe to
// call while requests are being served; the active logger reads the pointer
// atomically for every record.
func SetAlertSink(s AlertSink) {
	Init()
	if s == nil {
		sink.Store(nil)
		return
	}
	sink.Store(&alertSinkHolder{sink: s})
}

// FlushAlerts gives an optional sink a bounded opportunity to deliver queued
// events before a process exits. It is intentionally a no-op when alerts are
// disabled or the sink does not implement AlertFlusher.
func FlushAlerts(ctx context.Context) {
	if holder := sink.Load(); holder != nil {
		if f, ok := holder.sink.(interface{ Flush(context.Context) }); ok {
			f.Flush(ctx)
		}
	}
}

// ShutdownAlerts stops an optional sink after FlushAlerts has been given its
// delivery window.
func ShutdownAlerts() {
	if holder := sink.Load(); holder != nil {
		if s, ok := holder.sink.(interface{ Close() }); ok {
			s.Close()
		}
		sink.Store(nil)
	}
}

// alertHandler fans records to the ordinary structured logger and then makes
// an immutable copy for the optional alert sink. The stdout handler remains the
// source of truth even when Telegram is disabled or unavailable.
type alertBoundAttr struct {
	prefix string
	attr   slog.Attr
}

type alertHandler struct {
	slog.Handler
	group string
	attrs []alertBoundAttr
}

func (h *alertHandler) Handle(ctx context.Context, r slog.Record) error {
	err := h.Handler.Handle(ctx, r)
	if r.Level < slog.LevelError {
		return err
	}
	if holder := sink.Load(); holder != nil && holder.sink != nil {
		if event, ok := safeSnapshot(r); ok {
			for _, bound := range h.attrs {
				addAttr(event.Attrs, bound.prefix, bound.attr)
			}
			holder.sink.Enqueue(event)
		}
	}
	return err
}

func (h *alertHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	bound := append([]alertBoundAttr(nil), h.attrs...)
	for _, attr := range attrs {
		bound = append(bound, alertBoundAttr{prefix: h.group, attr: attr})
	}
	return &alertHandler{Handler: h.Handler.WithAttrs(attrs), group: h.group, attrs: bound}
}

func (h *alertHandler) WithGroup(name string) slog.Handler {
	group := h.group
	if group == "" {
		group = name
	} else if name != "" {
		group += "." + name
	}
	return &alertHandler{Handler: h.Handler.WithGroup(name), group: group, attrs: h.attrs}
}

func safeSnapshot(r slog.Record) (event AlertEvent, ok bool) {
	defer func() {
		if recover() != nil {
			event = AlertEvent{}
			ok = false
		}
	}()
	return snapshot(r), true
}

func snapshot(r slog.Record) AlertEvent {
	attrs := make(map[string]string)
	r.Attrs(func(a slog.Attr) bool {
		addAttr(attrs, "", a)
		return true
	})
	return AlertEvent{
		Time:    r.Time,
		Level:   r.Level,
		Message: r.Message,
		Attrs:   attrs,
	}
}

func addAttr(dst map[string]string, prefix string, attr slog.Attr) {
	key := attr.Key
	if prefix != "" {
		if key == "" {
			key = prefix
		} else {
			key = prefix + "." + key
		}
	}
	value := attr.Value.Resolve()
	if value.Kind() == slog.KindGroup {
		for _, child := range value.Group() {
			addAttr(dst, key, child)
		}
		return
	}
	if key == "" {
		return
	}
	if value.Kind() == slog.KindAny {
		dst[key] = fmt.Sprint(value.Any())
		return
	}
	dst[key] = value.String()
}

// contextHandler enriches every record with the chi request ID found in the
// log call's context, so error logs emitted mid-request carry the same
// request_id the client sees as trace_id. Use the LogXContext helpers (which
// pass ctx through) to benefit from it.
type contextHandler struct {
	slog.Handler
}

func (h *contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := chiMiddleware.GetReqID(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, r)
}

func (h *contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *contextHandler) WithGroup(name string) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithGroup(name)}
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// get returns the active logger, lazily initializing with defaults if Init
// was never called.
func get() *slog.Logger {
	if l := logger.Load(); l != nil {
		return l
	}
	Init()
	return logger.Load()
}

// LogError logs an error with a message and optional key-value pairs.
func LogError(msg string, err error, args ...any) {
	get().Error(msg, append([]any{"error", err}, args...)...)
}

// LogErrorContext is LogError carrying request-scoped context, so the entry is
// tagged with the request_id (see contextHandler). Prefer it inside handlers.
func LogErrorContext(ctx context.Context, msg string, err error, args ...any) {
	get().ErrorContext(ctx, msg, append([]any{"error", err}, args...)...)
}

// LogInfoContext is LogInfo carrying request-scoped context.
func LogInfoContext(ctx context.Context, msg string, args ...any) {
	get().InfoContext(ctx, msg, args...)
}

// LogWarnContext is LogWarn carrying request-scoped context.
func LogWarnContext(ctx context.Context, msg string, args ...any) {
	get().WarnContext(ctx, msg, args...)
}

// LogInfo logs an informational message with optional key-value pairs.
func LogInfo(msg string, args ...any) {
	get().Info(msg, args...)
}

// LogWarn logs a warning message with optional key-value pairs.
func LogWarn(msg string, args ...any) {
	get().Warn(msg, args...)
}

// LogDebug logs a debug message with optional key-value pairs.
func LogDebug(msg string, args ...any) {
	get().Debug(msg, args...)
}

// Logger returns the underlying *slog.Logger for callers that need it (e.g.
// to pass to libraries).
func Logger() *slog.Logger {
	return get()
}
