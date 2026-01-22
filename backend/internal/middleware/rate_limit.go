package middleware

import (
	"net/http"
	"sync"

	"golang.org/x/time/rate"
)

// RateLimiter manages rate limiting for different endpoints
type RateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*rate.Limiter),
	}
}

// GetLimiter gets or creates a rate limiter for the given key
func (rl *RateLimiter) GetLimiter(key string, r rate.Limit, b int) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	limiter, exists := rl.limiters[key]
	if !exists {
		limiter = rate.NewLimiter(r, b)
		rl.limiters[key] = limiter
	}

	return limiter
}

// RateLimitMiddleware creates rate limiting middleware
func RateLimitMiddleware(limiter *rate.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check rate limit
			if !limiter.Allow() {
				http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// Create specific rate limiters for different endpoints
var (
	// 100 requests per second for registration
	RegisterLimiter = rate.NewLimiter(100, 100)

	// 50 requests per second for login
	LoginLimiter = rate.NewLimiter(50, 50)

	// 100 requests per second for authenticated endpoints
	AuthLimiter = rate.NewLimiter(100, 100)
)
