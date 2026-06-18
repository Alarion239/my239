// Package ratelimit provides per-IP HTTP rate limiting with pluggable
// backends. The Limiter interface accepts a logical "key" (route name) so
// callers can have separate quotas for /login vs /register vs /me without
// each bucket leaking into the others.
//
// Two implementations are shipped:
//
//   - Memory: fixed-window counters held in-process. Fine for single-replica
//     deployments and unit tests; resets when the process restarts.
//   - Redis: identical fixed-window semantics but stored in Redis under
//     `ratelimit:<key>:<ip>:<bucket>` with a per-key TTL. Use this for
//     multi-replica deployments where every replica must share the same
//     bucket counts.
//
// The "fixed window" choice is deliberate: simpler, predictable, and good
// enough for the order-of-magnitude protection we need here. If we ever
// require strict smoothing we can add a sliding-log variant later.
package ratelimit

import (
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/Alarion239/my239/backend/internal/httpx"
)

// Limiter produces middleware that allows up to `limit` requests per
// `windowSeconds` for a given (key, client-IP) pair.
type Limiter interface {
	// Allow reports whether the request should be served. retryAfter is the
	// number of seconds the client should back off when allowed=false.
	Allow(r *http.Request, key string, limit int, windowSeconds int) (allowed bool, retryAfter int, err error)

	// Middleware returns an http middleware that calls Allow and rejects
	// over-quota requests with 429 + Retry-After header.
	Middleware(key string, limit int, windowSeconds int) func(http.Handler) http.Handler
}

// clientIP extracts the client IP. We trust whatever the upstream RealIP
// middleware (internal/middleware.RealIPMiddleware) has already put in
// r.RemoteAddr — that middleware reads X-Forwarded-For / X-Real-IP from the
// trusted proxy. If RemoteAddr happens to include a port, strip it.
func clientIP(r *http.Request) string {
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	if i := strings.IndexByte(addr, ':'); i >= 0 {
		return addr[:i]
	}
	return addr
}

// rejectOverLimit writes the canonical 429 response.
func rejectOverLimit(w http.ResponseWriter, r *http.Request, retryAfter int) {
	if retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	}
	httpx.WriteAPIError(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
		"too many requests, please slow down")
}
