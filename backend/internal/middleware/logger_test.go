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

// flushRecorder records whether Flush was called so we can assert the wrapper
// forwards it to the underlying writer (httptest.ResponseRecorder.Flush exists
// but exposes no flag we can read).
type flushRecorder struct {
	http.ResponseWriter
	flushed bool
}

func (f *flushRecorder) Flush() { f.flushed = true }

// SSE handlers do `w.(http.Flusher)`. The wrapper must satisfy http.Flusher and
// delegate to the underlying writer, or text/event-stream endpoints 500.
func TestResponseWriter_ForwardsFlush(t *testing.T) {
	inner := &flushRecorder{ResponseWriter: httptest.NewRecorder()}
	rw := &responseWriter{ResponseWriter: inner, statusCode: http.StatusOK}

	f, ok := any(rw).(http.Flusher)
	if !ok {
		t.Fatal("responseWriter does not implement http.Flusher")
	}
	f.Flush()
	if !inner.flushed {
		t.Error("Flush was not forwarded to the underlying ResponseWriter")
	}
}
