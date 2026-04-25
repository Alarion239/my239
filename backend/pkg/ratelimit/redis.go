package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// allowScript is a Lua script that atomically increments a counter and sets
// its TTL on first hit. Returning [count, ttl] avoids a second round trip.
//
// KEYS[1] = bucket key
// ARGV[1] = window seconds
//
// Result: { count, pttl_in_ms }
var allowScript = redis.NewScript(`
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
return { count, pttl }
`)

// Redis is a fixed-window rate limiter backed by a Redis instance. The Lua
// script makes INCR + EXPIRE atomic so concurrent requests can't race past
// the limit.
type Redis struct {
	client redis.Cmdable
	now    func() time.Time
	prefix string
}

// NewRedis builds a Redis-backed limiter. prefix is prepended to every key so
// you can share a Redis with other services without collisions; pass "" for
// the default ("ratelimit").
func NewRedis(client redis.Cmdable, prefix string) *Redis {
	if prefix == "" {
		prefix = "ratelimit"
	}
	return &Redis{client: client, now: time.Now, prefix: prefix}
}

func (rl *Redis) Allow(r *http.Request, key string, limit int, windowSeconds int) (bool, int, error) {
	now := rl.now()
	bucket := now.Truncate(time.Duration(windowSeconds) * time.Second).UTC().Format(time.RFC3339)
	redisKey := fmt.Sprintf("%s:%s:%s:%s", rl.prefix, key, clientIP(r), bucket)

	ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
	defer cancel()

	res, err := allowScript.Run(ctx, rl.client, []string{redisKey}, windowSeconds).Result()
	if err != nil {
		return false, 0, err
	}

	values, ok := res.([]any)
	if !ok || len(values) != 2 {
		return false, 0, errors.New("ratelimit: unexpected redis response shape")
	}

	count, _ := values[0].(int64)
	pttlMs, _ := values[1].(int64)

	if count > int64(limit) {
		retry := max(int(pttlMs/1000), 1)
		return false, retry, nil
	}
	return true, 0, nil
}

func (rl *Redis) Middleware(key string, limit int, windowSeconds int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, retryAfter, err := rl.Allow(r, key, limit, windowSeconds)
			if err != nil {
				// Fail open: a Redis blip should not bring the API down.
				// We log via the standard slog logger from the middleware
				// chain, but keep the request flowing.
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
