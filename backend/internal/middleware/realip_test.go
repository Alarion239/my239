package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRealIPMiddleware(t *testing.T) {
	tests := []struct {
		name       string
		xRealIP    string
		xForwarded string
		remoteAddr string
		want       string
	}{
		{
			name:       "no proxy headers leaves RemoteAddr untouched",
			remoteAddr: "10.0.0.1:5555",
			want:       "10.0.0.1:5555",
		},
		{
			name:       "X-Real-IP wins",
			xRealIP:    "203.0.113.7",
			xForwarded: "198.51.100.2, 10.0.0.1",
			remoteAddr: "10.0.0.1:5555",
			want:       "203.0.113.7",
		},
		{
			name:       "leftmost X-Forwarded-For when no X-Real-IP",
			xForwarded: "198.51.100.2, 10.0.0.1",
			remoteAddr: "10.0.0.1:5555",
			want:       "198.51.100.2",
		},
		{
			name:       "single X-Forwarded-For value",
			xForwarded: "198.51.100.9",
			remoteAddr: "10.0.0.1:5555",
			want:       "198.51.100.9",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got string
			next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = r.RemoteAddr
			})

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.xRealIP != "" {
				req.Header.Set("X-Real-IP", tt.xRealIP)
			}
			if tt.xForwarded != "" {
				req.Header.Set("X-Forwarded-For", tt.xForwarded)
			}

			RealIPMiddleware(next).ServeHTTP(httptest.NewRecorder(), req)

			if got != tt.want {
				t.Fatalf("RemoteAddr = %q, want %q", got, tt.want)
			}
		})
	}
}
