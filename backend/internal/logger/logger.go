package logger

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

var Logger *slog.Logger

// Init initializes the logger to output to both console and file with JSON format
func Init() {
	// Create logs directory if it doesn't exist
	logDir := "logs"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		// Fallback to stdout only if we can't create the directory
		handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level:     slog.LevelInfo,
			AddSource: true,
		})
		Logger = slog.New(handler)
		return
	}

	// Open log file (append mode, create if not exists)
	logFile, err := os.OpenFile(filepath.Join(logDir, "app.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		// Fallback to stdout only if we can't open the file
		handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
			Level:     slog.LevelInfo,
			AddSource: true,
		})
		Logger = slog.New(handler)
		return
	}

	// Create multi-writer to output to both stdout and file
	multiWriter := io.MultiWriter(os.Stdout, logFile)

	handler := slog.NewJSONHandler(multiWriter, &slog.HandlerOptions{
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
