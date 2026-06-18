package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// Column list must match the SELECT order in the SeriesProblemStats query.
var problemStatsRowColumns = []string{
	"student_user_id", "problem_id", "problem_number", "subproblem_id", "current_status",
}

type problemStatsResp struct {
	TotalStudents int `json:"total_students"`
	Problems      []struct {
		ProblemID      int64  `json:"problem_id"`
		ProblemNumber  int    `json:"problem_number"`
		ProblemDisplay string `json:"problem_display"`
		Accepted       int    `json:"accepted"`
		Appealed       int    `json:"appealed"`
		Rejected       int    `json:"rejected"`
		Submitted      int    `json:"submitted"`
		Unsolved       int    `json:"unsolved"`
	} `json:"problems"`
}

func expectSeriesForStats(mock pgxmock.PgxPoolIface, seriesID, centerID int64, now time.Time) {
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(seriesID).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(seriesID, centerID, int32(1), "S", now.Add(time.Hour), (*string)(nil), &now, now, (*string)(nil)))
}

func statRow(studentID, problemID int64, problemNumber int32, subproblemID int64, status string) []any {
	return []any{studentID, problemID, problemNumber, subproblemID, status}
}

func TestProblemStats_DerivationPrecedence(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	expectTeacherCheck(mock, 3, 42, true)

	// One problem (id 500, number 1) with two subproblems (a=900, b=901).
	// Five students, each landing in a distinct bucket:
	//   s1: a=accepted,  b=accepted   -> accepted  (ALL accepted)
	//   s2: a=appealed,  b=rejected   -> appealed  (appealed beats rejected)
	//   s3: a=rejected,  b=accepted   -> rejected  (rejected beats accepted-but-not-all)
	//   s4: a=submitted, b=ungraded   -> submitted
	//   s5: a=ungraded,  b=ungraded   -> unsolved
	mock.ExpectQuery(`FROM math_center_students mcs\s+JOIN math_center_groups`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "accepted")...).
			AddRow(statRow(1, 500, 1, 901, "accepted")...).
			AddRow(statRow(2, 500, 1, 900, "appealed")...).
			AddRow(statRow(2, 500, 1, 901, "rejected")...).
			AddRow(statRow(3, 500, 1, 900, "rejected")...).
			AddRow(statRow(3, 500, 1, 901, "accepted")...).
			AddRow(statRow(4, 500, 1, 900, "submitted")...).
			AddRow(statRow(4, 500, 1, 901, "ungraded")...).
			AddRow(statRow(5, 500, 1, 900, "ungraded")...).
			AddRow(statRow(5, 500, 1, 901, "ungraded")...))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/problem-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp problemStatsResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TotalStudents != 5 {
		t.Fatalf("total_students = %d, want 5", resp.TotalStudents)
	}
	if len(resp.Problems) != 1 {
		t.Fatalf("want 1 problem, got %d", len(resp.Problems))
	}
	p := resp.Problems[0]
	if p.ProblemID != 500 || p.ProblemNumber != 1 || p.ProblemDisplay != "Задача 1" {
		t.Errorf("problem header wrong: %+v", p)
	}
	if p.Accepted != 1 || p.Appealed != 1 || p.Rejected != 1 || p.Submitted != 1 || p.Unsolved != 1 {
		t.Errorf("buckets = a%d ap%d r%d s%d u%d, want 1/1/1/1/1", p.Accepted, p.Appealed, p.Rejected, p.Submitted, p.Unsolved)
	}
	if sum := p.Accepted + p.Appealed + p.Rejected + p.Submitted + p.Unsolved; sum != resp.TotalStudents {
		t.Errorf("buckets sum %d != total_students %d", sum, resp.TotalStudents)
	}
}

func TestProblemStats_MultipleProblemsOrdered(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	expectTeacherCheck(mock, 3, 42, true)

	// Two problems, two students. Problem 1 (id 500): both subproblems
	// accepted for s1 -> accepted; s2 has one submitted -> submitted.
	// Problem 2 (id 501, single sentinel subproblem 950): s1 rejected,
	// s2 ungraded. Rows arrive number-ordered (1 then 2) from SQL.
	mock.ExpectQuery(`FROM math_center_students mcs\s+JOIN math_center_groups`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "accepted")...).
			AddRow(statRow(1, 500, 1, 901, "accepted")...).
			AddRow(statRow(2, 500, 1, 900, "submitted")...).
			AddRow(statRow(2, 500, 1, 901, "accepted")...).
			AddRow(statRow(1, 501, 2, 950, "rejected")...).
			AddRow(statRow(2, 501, 2, 950, "ungraded")...))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/problem-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp problemStatsResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TotalStudents != 2 {
		t.Fatalf("total_students = %d, want 2", resp.TotalStudents)
	}
	if len(resp.Problems) != 2 {
		t.Fatalf("want 2 problems, got %d", len(resp.Problems))
	}
	if resp.Problems[0].ProblemNumber != 1 || resp.Problems[1].ProblemNumber != 2 {
		t.Fatalf("problems not ordered by number: %d then %d", resp.Problems[0].ProblemNumber, resp.Problems[1].ProblemNumber)
	}
	p1 := resp.Problems[0]
	if p1.Accepted != 1 || p1.Submitted != 1 || p1.Appealed != 0 || p1.Rejected != 0 || p1.Unsolved != 0 {
		t.Errorf("problem 1 buckets wrong: %+v", p1)
	}
	p2 := resp.Problems[1]
	if p2.Rejected != 1 || p2.Unsolved != 1 || p2.Accepted != 0 || p2.Appealed != 0 || p2.Submitted != 0 {
		t.Errorf("problem 2 buckets wrong: %+v", p2)
	}
	for _, p := range resp.Problems {
		if sum := p.Accepted + p.Appealed + p.Rejected + p.Submitted + p.Unsolved; sum != resp.TotalStudents {
			t.Errorf("problem %d buckets sum %d != total %d", p.ProblemNumber, sum, resp.TotalStudents)
		}
	}
}

func TestProblemStats_AdminAllowed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	// No teacher check: admin short-circuits requireTeacher via the JWT claim.
	mock.ExpectQuery(`FROM math_center_students mcs\s+JOIN math_center_groups`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "accepted")...))

	req := authedRequest(t, access, 9, true, http.MethodGet, "/series/100/problem-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("admin got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp problemStatsResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TotalStudents != 1 || len(resp.Problems) != 1 || resp.Problems[0].Accepted != 1 {
		t.Errorf("unexpected admin response: %+v", resp)
	}
}

func TestProblemStats_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/problem-stats", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}
