package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestMyRollup_GroupsByProblemAndCounts(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	pub := now.Add(-time.Hour)
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), &pub, now, (*string)(nil), (*string)(nil), (*string)(nil), (*string)(nil)))
	expectStudentCheck(mock, 7, 42, true)

	// Rollup rows: problem 1 has subparts a, b; problem 2 (sentinel) is single empty-label row.
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems p\s+ON p.id = sp.problem_id\s+LEFT JOIN homework_thread t`).
		WithArgs(int64(100), int64(7)).
		WillReturnRows(mock.NewRows([]string{
			"subproblem_id", "subproblem_label", "problem_id", "problem_number",
			"thread_id", "current_status", "being_graded",
		}).
			AddRow(int64(900), "a", int64(500), int32(1), int64(1), "accepted", false).
			AddRow(int64(901), "b", int64(500), int32(1), int64(2), "submitted", true).
			AddRow(int64(910), "", int64(501), int32(2), int64(0), "ungraded", false))

	mock.ExpectQuery(`COUNT\(\*\) FILTER`).
		WithArgs(int64(100), int64(7)).
		WillReturnRows(mock.NewRows([]string{"accepted_count", "rejected_count", "pending_count"}).
			AddRow(int64(1), int64(1), int64(1)))

	req := authedRequest(t, access, 7, false, http.MethodGet, "/series/100/my", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Counts struct {
			Accepted int64 `json:"accepted"`
			Rejected int64 `json:"rejected"`
			Pending  int64 `json:"pending"`
		} `json:"counts"`
		Problems []struct {
			ProblemNumber  int    `json:"problem_number"`
			ProblemDisplay string `json:"problem_display"`
			Subproblems    []struct {
				Label       string `json:"subproblem_label"`
				Status      string `json:"current_status"`
				BeingGraded bool   `json:"being_graded"`
			} `json:"subproblems"`
		} `json:"problems"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Counts.Accepted != 1 || resp.Counts.Rejected != 1 || resp.Counts.Pending != 1 {
		t.Errorf("counts wrong: %+v", resp.Counts)
	}
	if len(resp.Problems) != 2 {
		t.Fatalf("want 2 problems, got %d", len(resp.Problems))
	}
	if resp.Problems[0].ProblemDisplay != "Задача 1" || len(resp.Problems[0].Subproblems) != 2 {
		t.Errorf("problem 1 wrong: %+v", resp.Problems[0])
	}
	// The claimed submission surfaces being_graded=true so the student can see
	// "На проверке" rather than a bare "В очереди".
	if !resp.Problems[0].Subproblems[1].BeingGraded {
		t.Errorf("expected subproblem b to be flagged being_graded: %+v", resp.Problems[0].Subproblems[1])
	}
	if resp.Problems[1].ProblemDisplay != "Задача 2" || len(resp.Problems[1].Subproblems) != 1 {
		t.Errorf("problem 2 wrong: %+v", resp.Problems[1])
	}
	if resp.Problems[1].Subproblems[0].Status != "ungraded" {
		t.Errorf("ungraded subproblem missing: %+v", resp.Problems[1].Subproblems)
	}
}

func TestMyRollup_DraftHiddenFromStudent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil), (*string)(nil), (*string)(nil), (*string)(nil)))
	expectStudentCheck(mock, 7, 42, true)

	req := authedRequest(t, access, 7, false, http.MethodGet, "/series/100/my", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404 (unpublished hidden)", rr.Code)
	}
}

func TestMyRollup_NonStudentForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	pub := now.Add(-time.Hour)
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), &pub, now, (*string)(nil), (*string)(nil), (*string)(nil), (*string)(nil)))
	expectStudentCheck(mock, 7, 42, false)

	req := authedRequest(t, access, 7, false, http.MethodGet, "/series/100/my", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
