package homework_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

// TestRouter_RequiresAuth blanket-checks that every route under
// /homework rejects unauthenticated requests with 401.
func TestRouter_RequiresAuth(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, _, _ := newRouter(t, mock)

	cases := []struct {
		method, path string
	}{
		{http.MethodPost, "/threads/1/upload-urls"},
		{http.MethodPost, "/threads/1/submit"},
		{http.MethodPost, "/threads/1/appeal"},
		{http.MethodGet, "/threads/by-id/1"},
		{http.MethodPost, "/threads/by-id/1/upload-urls"},
		{http.MethodPost, "/threads/by-id/1/claim"},
		{http.MethodPost, "/threads/by-id/1/claim/heartbeat"},
		{http.MethodPost, "/threads/by-id/1/claim/release"},
		{http.MethodPost, "/threads/by-id/1/grade"},
		{http.MethodPost, "/threads/by-id/1/retract"},
		{http.MethodGet, "/series/1/my"},
		{http.MethodGet, "/series/1/queue"},
		{http.MethodGet, "/series/1/grid"},
		{http.MethodGet, "/centers/1/grader-stats"},
		{http.MethodGet, "/centers/1/grid"},
	}
	for _, c := range cases {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Errorf("got %d, want 401", rr.Code)
			}
		})
	}
}
