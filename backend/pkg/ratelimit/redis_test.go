package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newMini(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return mr, client
}

func TestRedis_AllowsUpToLimit(t *testing.T) {
	_, client := newMini(t)
	rl := NewRedis(client, "test")

	for i := 1; i <= 3; i++ {
		ok, _, err := rl.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Errorf("request %d: expected allowed", i)
		}
	}
	allowed, retry, err := rl.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Error("4th request should be rejected")
	}
	if retry < 1 {
		t.Errorf("retry-after: got %d", retry)
	}
}

func TestRedis_PerIPIsolation(t *testing.T) {
	_, client := newMini(t)
	rl := NewRedis(client, "test")

	for range 3 {
		rl.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	}
	allowed, _, _ := rl.Allow(reqFromIP("2.2.2.2"), "k", 3, 60)
	if !allowed {
		t.Error("different IP should have its own bucket")
	}
}

func TestRedis_TTLApplied(t *testing.T) {
	mr, client := newMini(t)
	rl := NewRedis(client, "test")

	rl.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)

	// Walk Redis keys; expect exactly one matching our prefix and a TTL set.
	keys := mr.Keys()
	if len(keys) != 1 {
		t.Fatalf("expected 1 key in Redis, got %d (%v)", len(keys), keys)
	}
	ttl := mr.TTL(keys[0])
	if ttl <= 0 {
		t.Errorf("expected TTL > 0, got %v", ttl)
	}
}

func TestRedis_Middleware_FailsOpenOnRedisDown(t *testing.T) {
	mr, client := newMini(t)
	rl := NewRedis(client, "test")
	mr.Close() // simulate Redis being unreachable

	h := rl.Middleware("k", 3, 60)(http.HandlerFunc(ok))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, reqFromIP("1.1.1.1"))

	// Fail-open: even though Redis is down, the request should be served.
	if rr.Code != http.StatusOK {
		t.Errorf("fail-open behavior: got %d, want 200", rr.Code)
	}
}

func TestRedis_DefaultPrefix(t *testing.T) {
	_, client := newMini(t)
	rl := NewRedis(client, "")
	if rl.prefix != "ratelimit" {
		t.Errorf("default prefix: got %q", rl.prefix)
	}
}
