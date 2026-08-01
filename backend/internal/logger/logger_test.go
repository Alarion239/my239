package logger

import (
	"context"
	"errors"
	"log/slog"
	"testing"
)

type testAlertSink struct {
	events chan AlertEvent
}

func (s *testAlertSink) Enqueue(event AlertEvent) {
	s.events <- event
}

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

func TestAlertSinkCapturesOnlyErrorRecords(t *testing.T) {
	Init()
	sink := &testAlertSink{events: make(chan AlertEvent, 4)}
	SetAlertSink(sink)
	defer SetAlertSink(nil)

	LogInfo("not an alert")
	slog.Warn("also not an alert")
	slog.ErrorContext(context.Background(), "direct error", "error", errors.New("boom"), "request_id", "req-1")

	select {
	case event := <-sink.events:
		if event.Message != "direct error" {
			t.Fatalf("message: got %q", event.Message)
		}
		if event.Attrs["error"] != "boom" {
			t.Fatalf("error attr: got %q", event.Attrs["error"])
		}
		if event.Attrs["request_id"] != "req-1" {
			t.Fatalf("request id: got %q", event.Attrs["request_id"])
		}
	default:
		t.Fatal("expected one error event")
	}
	select {
	case extra := <-sink.events:
		t.Fatalf("unexpected extra event: %+v", extra)
	default:
	}
}

func TestAlertSinkSurvivesLoggerWith(t *testing.T) {
	Init()
	sink := &testAlertSink{events: make(chan AlertEvent, 1)}
	SetAlertSink(sink)
	defer SetAlertSink(nil)

	Logger().With("scope", "worker").Error("wrapped error")
	select {
	case event := <-sink.events:
		if event.Message != "wrapped error" || event.Attrs["scope"] != "worker" {
			t.Fatalf("event: %+v", event)
		}
	default:
		t.Fatal("expected an error from Logger().With")
	}
}
