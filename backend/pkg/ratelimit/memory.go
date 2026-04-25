package ratelimit

import (
	"net/http"
	"sync"
	"time"
)

// Memory is an in-process fixed-window rate limiter. Safe for concurrent use.
//
// Counters are kept in a map keyed by "<route>:<ip>:<bucket>"; each bucket
// holds the number of hits and the wall-clock time when it expires. A
// background sweeper runs lazily on each Allow call to evict stale buckets;
// good enough at our request volume that a dedicated goroutine isn't worth
// the complexity.
type Memory struct {
	now func() time.Time

	mu      sync.Mutex
	buckets map[string]*memBucket
	// nextSweep is the wall-clock time at which we'll next try to GC stale
	// buckets. We keep it cheap by only sweeping every ~30 seconds.
	nextSweep time.Time
}

type memBucket struct {
	count     int
	expiresAt time.Time
}

// NewMemory constructs a Memory limiter.
func NewMemory() *Memory {
	return &Memory{
		now:       time.Now,
		buckets:   make(map[string]*memBucket),
		nextSweep: time.Now().Add(30 * time.Second),
	}
}

func (m *Memory) Allow(r *http.Request, key string, limit int, windowSeconds int) (bool, int, error) {
	now := m.now()
	bucketStart := now.Truncate(time.Duration(windowSeconds) * time.Second)
	bucketKey := key + ":" + clientIP(r) + ":" + bucketStart.UTC().Format(time.RFC3339)

	m.mu.Lock()
	defer m.mu.Unlock()

	if now.After(m.nextSweep) {
		m.sweepLocked(now)
		m.nextSweep = now.Add(30 * time.Second)
	}

	b, ok := m.buckets[bucketKey]
	if !ok || now.After(b.expiresAt) {
		b = &memBucket{expiresAt: bucketStart.Add(time.Duration(windowSeconds) * time.Second)}
		m.buckets[bucketKey] = b
	}
	b.count++

	if b.count > limit {
		retry := max(int(b.expiresAt.Sub(now).Seconds()), 1)
		return false, retry, nil
	}
	return true, 0, nil
}

func (m *Memory) sweepLocked(now time.Time) {
	for k, b := range m.buckets {
		if now.After(b.expiresAt) {
			delete(m.buckets, k)
		}
	}
}

func (m *Memory) Middleware(key string, limit int, windowSeconds int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, retryAfter, err := m.Allow(r, key, limit, windowSeconds)
			if err != nil {
				// Memory limiter never errors today, but if it ever does we
				// fail open: better to serve the request than to surface a
				// 5xx for limiter-internal problems.
				next.ServeHTTP(w, r)
				return
			}
			if !ok {
				rejectOverLimit(w, r, retryAfter)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
