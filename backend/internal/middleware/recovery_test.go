package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

func TestRecoveryMiddlewareReturnsStructuredInternalError(t *testing.T) {
	r := chi.NewRouter()
	r.Use(chiMiddleware.RequestID)
	r.Use(LoggerMiddleware)
	r.Use(RecoveryMiddleware)
	r.Get("/panic", func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})

	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", res.Code)
	}
	if got := res.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content type: got %q", got)
	}
	if body := res.Body.String(); body == "" || !contains(body, "internal_error") {
		t.Fatalf("body does not contain internal error envelope: %q", body)
	}
}

func TestRecoveryMiddlewarePreservesAbortHandler(t *testing.T) {
	r := RecoveryMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	defer func() {
		recovered, ok := recover().(error)
		if !ok || !errors.Is(recovered, http.ErrAbortHandler) {
			t.Fatalf("panic: got %v, want http.ErrAbortHandler", recovered)
		}
	}()
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestRecoveryMiddlewareDoesNotAppendAfterResponseStarted(t *testing.T) {
	h := RecoveryMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("partial"))
		panic("after write")
	}))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
	if res.Code != http.StatusAccepted || res.Body.String() != "partial" {
		t.Fatalf("response: status=%d body=%q", res.Code, res.Body.String())
	}
}

func contains(s, part string) bool {
	for i := 0; i+len(part) <= len(s); i++ {
		if s[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
