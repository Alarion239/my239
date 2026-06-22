package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/metrics"
)

// LoggerMiddleware logs each HTTP request with the chi request ID (so entries
// correlate across the stack) and records request count + latency metrics
// keyed by the matched route pattern.
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(rw, r)

		duration := time.Since(start)

		// Route pattern is only known after routing. Fall back to a constant
		// for unmatched paths so 404 scans can't inflate label cardinality.
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		status := strconv.Itoa(rw.statusCode)
		metrics.RequestDuration.WithLabelValues(r.Method, route, status).Observe(duration.Seconds())
		metrics.RequestsTotal.WithLabelValues(r.Method, route, status).Inc()

		logger.LogInfoContext(r.Context(), "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"route", route,
			"status", rw.statusCode,
			"bytes", rw.bytes,
			"duration_ms", duration.Milliseconds(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

// responseWriter captures the status code and byte count written by the handler.
type responseWriter struct {
	http.ResponseWriter
	statusCode  int
	bytes       int
	wroteHeader bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if rw.wroteHeader {
		return
	}
	rw.wroteHeader = true
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHeader {
		rw.wroteHeader = true
	}
	n, err := rw.ResponseWriter.Write(b)
	rw.bytes += n
	return n, err
}

// Flush forwards to the underlying ResponseWriter's Flusher so streaming
// (text/event-stream) handlers keep working through this wrapper. Flush is not
// part of http.ResponseWriter, so embedding alone does NOT promote it — without
// this method `w.(http.Flusher)` in SSE handlers fails and the stream 500s.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.ResponseController reach the underlying writer for any other
// optional interfaces (e.g. Hijacker) this wrapper doesn't explicitly forward.
func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}
