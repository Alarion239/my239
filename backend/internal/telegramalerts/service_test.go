package telegramalerts

import (
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/logger"
)

func TestFormatEventRedactsSensitiveFieldsAndBoundsStack(t *testing.T) {
	stack := strings.Repeat("frame\n", 1000)
	message := formatEvent(logger.AlertEvent{
		Time:    time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC),
		Level:   slog.LevelError,
		Message: "database failure",
		Attrs: map[string]string{
			"error":         "connection failed",
			"request_id":    "req-1",
			"component":     "database",
			"authorization": "Bearer should-not-appear",
			"stack":         stack,
		},
	}, "production")

	if len(message) > alertMaxMessageBytes {
		t.Fatalf("message length: got %d", len(message))
	}
	if strings.Contains(message, "should-not-appear") {
		t.Fatal("sensitive authorization value was included")
	}
	if !strings.Contains(message, "req-1") || !strings.Contains(message, "database failure") || !strings.Contains(message, "component: database") {
		t.Fatalf("message lost diagnostic fields: %q", message)
	}
}

func TestFormatBatchPreservesEveryEventAcrossChunks(t *testing.T) {
	events := make([]logger.AlertEvent, 40)
	for i := range events {
		events[i] = logger.AlertEvent{
			Time:    time.Now(),
			Level:   slog.LevelError,
			Message: fmt.Sprintf("event-%02d", i) + " " + strings.Repeat("x", 180),
		}
	}
	chunks := formatBatch(events, "production")
	if len(chunks) < 2 {
		t.Fatalf("expected chunks for 40 events, got %d", len(chunks))
	}
	joined := strings.Join(chunks, "\n")
	for i := range events {
		want := fmt.Sprintf("event-%02d", i)
		if !strings.Contains(joined, want) {
			t.Errorf("missing %s", want)
		}
	}
}

func TestDroppedSummaryIsPlainDiagnosticEvent(t *testing.T) {
	message := formatEvent(droppedSummary(7), "production")
	if !strings.Contains(message, "telegram alerts were dropped") || !strings.Contains(message, "dropped_count: 7") {
		t.Fatalf("summary: %q", message)
	}
}

func TestVerifyPasswordUsesConfiguredSecret(t *testing.T) {
	s := NewService(testTelegramConfig(), nil, nil)
	if !s.VerifyPassword("a-very-long-secret-password") {
		t.Fatal("expected configured password to verify")
	}
	if s.VerifyPassword("wrong-password") {
		t.Fatal("unexpected password match")
	}
}

func testTelegramConfig() config.TelegramAlertsConfig {
	return config.TelegramAlertsConfig{
		BotToken:          "bot-token",
		SubscribePassword: "a-very-long-secret-password",
		WebhookSecret:     "webhook-secret",
		WebhookURL:        "https://example.com/api/v1/telegram-alerts/webhook",
		Environment:       "production",
	}
}
