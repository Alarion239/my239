// Package logger provides a small wrapper around log/slog so the rest of the
// codebase can log without threading a *slog.Logger around and without caring
// whether Init has been called yet.
package logger

import (
	"log/slog"
	"os"
	"strings"
	"sync"
)

var (
	logger *slog.Logger
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
		logger = slog.New(handler)
	})
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

func ensureInit() {
	if logger == nil {
		Init()
	}
}

// LogError logs an error with a message and optional key-value pairs.
func LogError(msg string, err error, args ...any) {
	ensureInit()
	logger.Error(msg, append([]any{"error", err}, args...)...)
}

// LogInfo logs an informational message with optional key-value pairs.
func LogInfo(msg string, args ...any) {
	ensureInit()
	logger.Info(msg, args...)
}

// LogWarn logs a warning message with optional key-value pairs.
func LogWarn(msg string, args ...any) {
	ensureInit()
	logger.Warn(msg, args...)
}

// LogDebug logs a debug message with optional key-value pairs.
func LogDebug(msg string, args ...any) {
	ensureInit()
	logger.Debug(msg, args...)
}

// Logger returns the underlying *slog.Logger for callers that need it (e.g.
// to pass to libraries).
func Logger() *slog.Logger {
	ensureInit()
	return logger
}
