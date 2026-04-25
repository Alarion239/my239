package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoggerMiddleware_PassesThrough(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hi"))
	})

	h := LoggerMiddleware(next)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if !called {
		t.Error("next handler was not invoked")
	}
	if rr.Code != http.StatusTeapot {
		t.Errorf("status: got %d", rr.Code)
	}
	if body := rr.Body.String(); body != "hi" {
		t.Errorf("body: got %q", body)
	}
}

func TestResponseWriter_DefaultStatusIs200(t *testing.T) {
	rw := &responseWriter{ResponseWriter: httptest.NewRecorder(), statusCode: http.StatusOK}
	_, err := rw.Write([]byte("no explicit WriteHeader"))
	if err != nil {
		t.Fatal(err)
	}
	if rw.statusCode != http.StatusOK {
		t.Errorf("default status: got %d", rw.statusCode)
	}
	if rw.bytes != len("no explicit WriteHeader") {
		t.Errorf("bytes: got %d", rw.bytes)
	}
}

func TestResponseWriter_IgnoresDoubleWriteHeader(t *testing.T) {
	rw := &responseWriter{ResponseWriter: httptest.NewRecorder(), statusCode: http.StatusOK}
	rw.WriteHeader(http.StatusCreated)
	rw.WriteHeader(http.StatusInternalServerError) // should be ignored
	if rw.statusCode != http.StatusCreated {
		t.Errorf("status: got %d, want 201", rw.statusCode)
	}
}
