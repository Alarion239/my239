package logger

import (
	"log/slog"
	"os"
)

var Logger *slog.Logger

// Init initializes the logger to output to console (stdout) with JSON format
func Init() {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     slog.LevelInfo,
		AddSource: true, // Include file and line number in logs
	})

	Logger = slog.New(handler)
}

// LogError logs an error with a message and optional key-value pairs
func LogError(msg string, err error, args ...any) {
	if Logger == nil {
		Init() // Auto-initialize if not done
	}

	attrs := []any{"error", err}
	attrs = append(attrs, args...)
	Logger.Error(msg, attrs...)
}

// LogErrorWithContext logs an error with additional context as a map
func LogErrorWithContext(msg string, err error, context map[string]any) {
	if Logger == nil {
		Init()
	}

	attrs := []any{"error", err}
	for k, v := range context {
		attrs = append(attrs, k, v)
	}
	Logger.Error(msg, attrs...)
}

// LogInfo logs an informational message with optional key-value pairs
func LogInfo(msg string, args ...any) {
	if Logger == nil {
		Init()
	}
	Logger.Info(msg, args...)
}

// LogWarn logs a warning message with optional key-value pairs
func LogWarn(msg string, args ...any) {
	if Logger == nil {
		Init()
	}
	Logger.Warn(msg, args...)
}

// LogDebug logs a debug message with optional key-value pairs
func LogDebug(msg string, args ...any) {
	if Logger == nil {
		Init()
	}
	Logger.Debug(msg, args...)
}
