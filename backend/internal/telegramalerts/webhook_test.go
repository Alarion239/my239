package telegramalerts

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebhookRejectsWrongSecret(t *testing.T) {
	s := NewService(testTelegramConfig(), nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", "wrong")
	res := httptest.NewRecorder()
	s.Webhook().ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d", res.Code)
	}
}

func TestWebhookAcknowledgesMalformedAuthenticatedUpdate(t *testing.T) {
	s := NewService(testTelegramConfig(), nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("not-json"))
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", "webhook-secret")
	res := httptest.NewRecorder()
	s.Webhook().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status: got %d", res.Code)
	}
}

func TestBotAPIErrorDoesNotContainToken(t *testing.T) {
	token := "do-not-leak-token"
	err := (&APIError{Method: "sendMessage", Description: "transport failure"}).Error()
	if strings.Contains(err, token) {
		t.Fatalf("error leaked bot token: %q", err)
	}
}
