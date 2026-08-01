package middleware

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
)

// RecoveryMiddleware recovers panics at the HTTP goroutine boundary, logs a
// structured record with the full local stack, and emits the same generic API
// error envelope used by other internal failures. http.ErrAbortHandler keeps
// net/http's connection-abort semantics and is intentionally re-panicked.
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tracker, alreadyTracked := w.(*responseWriter)
		var recoveryWriter *panicResponseWriter
		if !alreadyTracked {
			recoveryWriter = &panicResponseWriter{ResponseWriter: w}
			w = recoveryWriter
		}
		defer func() {
			value := recover()
			if value == nil {
				return
			}
			if value == http.ErrAbortHandler {
				panic(value)
			}

			stack := debug.Stack()
			route := ""
			if routeContext := chi.RouteContext(r.Context()); routeContext != nil {
				route = routeContext.RoutePattern()
			}
			logger.LogErrorContext(r.Context(), "http panic recovered",
				fmt.Errorf("panic: %v", value),
				"panic", fmt.Sprint(value),
				"stack", string(stack),
				"method", r.Method,
				"route", route,
				"path", r.URL.Path,
				"request_id", chiMiddleware.GetReqID(r.Context()),
			)

			// LoggerMiddleware wraps the writer before this middleware runs. Do
			// not append a JSON body after a streaming/partial response began.
			started := alreadyTracked && tracker.wroteHeader
			if recoveryWriter != nil {
				started = recoveryWriter.wroteHeader
			}
			if started {
				return
			}
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal server error")
		}()

		next.ServeHTTP(w, r)
	})
}

// panicResponseWriter tracks whether a handler began a response when recovery
// is used without the outer request logger (for example in an isolated test or
// a small standalone router). The production middleware stack already uses
// responseWriter, so RecoveryMiddleware does not double-wrap it there.
type panicResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *panicResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *panicResponseWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(p)
}

func (w *panicResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		w.wroteHeader = true
		f.Flush()
	}
}

func (w *panicResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
