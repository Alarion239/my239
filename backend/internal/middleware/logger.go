package middleware

import (
	"net/http"
	"time"

	"github.com/Alarion239/my239/backend/internal/logger"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// LoggerMiddleware logs HTTP requests with the chi request ID so entries can
// be correlated across the stack.
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(rw, r)

		logger.LogInfo("http request",
			"request_id", chiMiddleware.GetReqID(r.Context()),
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.statusCode,
			"bytes", rw.bytes,
			"duration_ms", time.Since(start).Milliseconds(),
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
