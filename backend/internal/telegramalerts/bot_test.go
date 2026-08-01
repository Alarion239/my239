package telegramalerts

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestBotClientUsesSecretTokenOnlyInRequestURL(t *testing.T) {
	const token = "secret-token"
	client := newBotClientForTest(token, "https://api.telegram.test", &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.Contains(r.URL.Path, "/bot"+token+"/") {
			return nil, fmt.Errorf("request path did not contain bot token: %q", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusBadRequest,
			Body:       io.NopCloser(strings.NewReader(`{"ok":false,"error_code":400,"description":"bad request"}`)),
			Header:     make(http.Header),
		}, nil
	})})
	err := client.SendMessage(t.Context(), 1, "test", nil)
	if err == nil {
		t.Fatal("expected Bot API error")
	}
	if strings.Contains(err.Error(), token) {
		t.Fatalf("Bot API error leaked token: %v", err)
	}
}

func TestBotClientParsesRetryAfter(t *testing.T) {
	client := newBotClientForTest("secret-token", "https://api.telegram.test", &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Body:       io.NopCloser(strings.NewReader(`{"ok":false,"error_code":429,"description":"too many requests","parameters":{"retry_after":7}}`)),
			Header:     make(http.Header),
		}, nil
	})})
	err := client.SendMessage(t.Context(), 1, "test", nil)
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("error type: %T", err)
	}
	if apiErr.RetryAfter != 7 {
		t.Fatalf("retry after: got %d", apiErr.RetryAfter)
	}
}
