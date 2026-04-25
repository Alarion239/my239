package middleware

import (
	"net/http"
)

// SecurityHeadersMiddleware sets the baseline browser-security headers on every
// response. Defaults are intentionally strict; if a future endpoint serves an
// HTML/JS surface that needs to relax CSP it should do so locally rather than
// loosening these globals.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

		next.ServeHTTP(w, r)
	})
}
