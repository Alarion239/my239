package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func noopHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestCORSMiddleware_AllowsAllowedOrigin(t *testing.T) {
	h := CORSMiddleware("https://app.example.com")(http.HandlerFunc(noopHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Errorf("allow-origin: got %q", got)
	}
}

func TestCORSMiddleware_RejectsDisallowedOrigin(t *testing.T) {
	h := CORSMiddleware("https://app.example.com")(http.HandlerFunc(noopHandler))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got == "https://evil.example.com" {
		t.Errorf("should not echo disallowed origin, got %q", got)
	}
}

func TestCORSMiddleware_PreflightReturns2xx(t *testing.T) {
	h := CORSMiddleware("https://app.example.com")(http.HandlerFunc(noopHandler))

	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	if rr.Code < 200 || rr.Code >= 300 {
		t.Errorf("preflight status: got %d", rr.Code)
	}
}
