package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func TestGraderStats_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectQuery(`SELECT\s+COUNT\(\*\)`).
		WithArgs(int64(42), int64(3)).
		WillReturnRows(mock.NewRows([]string{"pending_count", "my_claimed_count", "my_appeals_count"}).
			AddRow(int64(5), int64(2), int64(1)))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grader-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var v map[string]int64
	_ = json.Unmarshal(rr.Body.Bytes(), &v)
	if v["pending_count"] != 5 || v["my_claimed_count"] != 2 || v["my_appeals_count"] != 1 {
		t.Errorf("counters wrong: %+v", v)
	}
}

func TestGraderStats_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grader-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
