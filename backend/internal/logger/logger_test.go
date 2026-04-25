package logger

import (
	"log/slog"
	"testing"
)

func TestParseLevel(t *testing.T) {
	cases := map[string]slog.Level{
		"":        slog.LevelInfo,
		"info":    slog.LevelInfo,
		"INFO":    slog.LevelInfo,
		"debug":   slog.LevelDebug,
		"warn":    slog.LevelWarn,
		"warning": slog.LevelWarn,
		"error":   slog.LevelError,
		"bogus":   slog.LevelInfo,
	}
	for input, want := range cases {
		if got := parseLevel(input); got != want {
			t.Errorf("parseLevel(%q): got %v, want %v", input, got, want)
		}
	}
}

func TestLogInfoLazyInitDoesNotPanic(t *testing.T) {
	// Call without explicit Init to ensure ensureInit works on first call.
	// There's no easy way to reset the sync.Once in a unit test; we simply
	// exercise the path and assert no panic.
	LogInfo("hello", "key", "value")
	LogDebug("dbg")
	LogWarn("warn")
	LogError("err", nil)
	if Logger() == nil {
		t.Error("Logger() returned nil after initialization")
	}
}
