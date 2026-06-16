package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func ok(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

func reqFromIP(ip string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = ip + ":12345"
	return r
}

func TestMemory_AllowsUpToLimit(t *testing.T) {
	m := NewMemory()
	for i := 1; i <= 3; i++ {
		ok, _, err := m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Errorf("request %d: expected allowed", i)
		}
	}
	allowed, retry, _ := m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	if allowed {
		t.Error("4th request should be rejected")
	}
	if retry < 1 {
		t.Errorf("retry-after should be >= 1, got %d", retry)
	}
}

func TestMemory_PerIPIsolation(t *testing.T) {
	m := NewMemory()
	for range 3 {
		_, _, _ = m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	}
	allowed, _, _ := m.Allow(reqFromIP("2.2.2.2"), "k", 3, 60)
	if !allowed {
		t.Error("different IP should have its own bucket")
	}
}

func TestMemory_PerKeyIsolation(t *testing.T) {
	m := NewMemory()
	for range 3 {
		_, _, _ = m.Allow(reqFromIP("1.1.1.1"), "login", 3, 60)
	}
	allowed, _, _ := m.Allow(reqFromIP("1.1.1.1"), "register", 3, 60)
	if !allowed {
		t.Error("different key should have its own bucket")
	}
}

func TestMemory_WindowResets(t *testing.T) {
	m := NewMemory()
	t0 := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return t0 }

	for range 3 {
		_, _, _ = m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	}
	allowed, _, _ := m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	if allowed {
		t.Error("over limit within window should reject")
	}

	// Advance past the window.
	m.now = func() time.Time { return t0.Add(2 * time.Minute) }
	allowed, _, _ = m.Allow(reqFromIP("1.1.1.1"), "k", 3, 60)
	if !allowed {
		t.Error("after window expires the bucket should reset")
	}
}

func TestMemory_Middleware_ReturnsRetryAfter(t *testing.T) {
	m := NewMemory()
	h := m.Middleware("k", 1, 60)(http.HandlerFunc(ok))

	// First call: ok.
	rr1 := httptest.NewRecorder()
	h.ServeHTTP(rr1, reqFromIP("1.1.1.1"))
	if rr1.Code != http.StatusOK {
		t.Errorf("first call: got %d", rr1.Code)
	}

	// Second call: 429 + Retry-After.
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, reqFromIP("1.1.1.1"))
	if rr2.Code != http.StatusTooManyRequests {
		t.Errorf("second call: got %d, want 429", rr2.Code)
	}
	if rr2.Header().Get("Retry-After") == "" {
		t.Error("Retry-After header should be set")
	}
}

func TestClientIP_StripsPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.5:54321"
	if got := clientIP(r); got != "203.0.113.5" {
		t.Errorf("got %q", got)
	}
}

func TestClientIP_NoPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1"
	if got := clientIP(r); got != "10.0.0.1" {
		t.Errorf("got %q", got)
	}
}
