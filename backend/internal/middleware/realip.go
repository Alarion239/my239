package middleware

import (
	"net/http"
	"strings"
)

// RealIPMiddleware sets r.RemoteAddr to the client IP reported by the trusted
// reverse proxy, reading X-Real-IP or the leftmost X-Forwarded-For value.
//
// It replaces chi's middleware.RealIP, which was deprecated (SA1019) because
// blindly trusting these headers lets a client spoof its IP when the server is
// directly reachable. Downstream consumers — per-IP rate limiting
// (pkg/ratelimit) and request logging — read the resulting r.RemoteAddr.
//
// SECURITY: this is only safe because in production the backend is reachable
// ONLY through the trusted nginx proxy, which overwrites X-Forwarded-For /
// X-Real-IP. Do NOT expose this service directly to untrusted clients without
// first restricting which upstreams are trusted (e.g. a trusted-proxy CIDR
// allowlist here) — otherwise an attacker can forge their IP to evade rate
// limits or poison logs.
func RealIPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ip := realIP(r); ip != "" {
			r.RemoteAddr = ip
		}
		next.ServeHTTP(w, r)
	})
}

// realIP returns the client IP from the proxy headers, preferring X-Real-IP and
// falling back to the leftmost (original client) entry of X-Forwarded-For.
func realIP(r *http.Request) string {
	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
		return xrip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	return ""
}
