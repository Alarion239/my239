// Package logger provides a small wrapper around log/slog so the rest of the
// codebase can log without threading a *slog.Logger around and without caring
// whether Init has been called yet.
package logger

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// logger holds the active *slog.Logger. It is an atomic pointer because Init
// (which writes it) races with the LogX helpers (which read it from every
// request goroutine); a plain package var would be a data race under -race.
var (
	logger atomic.Pointer[slog.Logger]
	once   sync.Once
)

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
		l := slog.New(&contextHandler{Handler: handler})
		logger.Store(l)
		// Route the stdlib default through the same handler so library code
		// (and packages that must not import this one) logs consistently.
		slog.SetDefault(l)
	})
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
