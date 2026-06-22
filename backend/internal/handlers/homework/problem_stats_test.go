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
	"student_user_id", "problem_id", "problem_number", "subproblem_id", "subproblem_label", "current_status",
}

type problemStatsResp struct {
	TotalStudents int `json:"total_students"`
	Problems      []struct {
		ProblemID       int64  `json:"problem_id"`
		ProblemNumber   int    `json:"problem_number"`
		ProblemDisplay  string `json:"problem_display"`
		SubproblemID    int64  `json:"subproblem_id"`
		SubproblemLabel string `json:"subproblem_label"`
		Accepted        int    `json:"accepted"`
		Appealed        int    `json:"appealed"`
		Rejected        int    `json:"rejected"`
		Submitted       int    `json:"submitted"`
		Unsolved        int    `json:"unsolved"`
	} `json:"problems"`
}

func expectSeriesForStats(mock pgxmock.PgxPoolIface, seriesID, centerID int64, now time.Time) {
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(seriesID).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(seriesID, centerID, int32(1), "S", now.Add(time.Hour), (*string)(nil), &now, now, (*string)(nil)))
}

func statRow(studentID, problemID int64, problemNumber int32, subproblemID int64, label, status string) []any {
	sid := studentID
	return []any{&sid, problemID, problemNumber, subproblemID, label, status}
}

// emptyRosterRow is the placeholder row the SQL emits for a subproblem when the
// center has no enrolled students: student_user_id is NULL, status 'ungraded'.
func emptyRosterRow(problemID int64, problemNumber int32, subproblemID int64, label string) []any {
	return []any{(*int64)(nil), problemID, problemNumber, subproblemID, label, "ungraded"}
}

// Each subproblem (1а, 1б) is reported as its own line — statuses are counted
// per subproblem, never folded into the parent problem.
func TestProblemStats_PerSubproblemCounts(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	expectTeacherCheck(mock, 3, 42, true)

	// One problem (id 500, number 1) with two subproblems (a=900, b=901),
	// five students. Counted per subproblem:
	//   900 (а): accepted/appealed/rejected/submitted/ungraded -> 1/1/1/1/1
	//   901 (б): accepted x2, rejected x1, ungraded x2          -> 2/0/1/0/2
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "a", "accepted")...).
			AddRow(statRow(2, 500, 1, 900, "a", "appealed")...).
			AddRow(statRow(3, 500, 1, 900, "a", "rejected")...).
			AddRow(statRow(4, 500, 1, 900, "a", "submitted")...).
			AddRow(statRow(5, 500, 1, 900, "a", "ungraded")...).
			AddRow(statRow(1, 500, 1, 901, "b", "accepted")...).
			AddRow(statRow(2, 500, 1, 901, "b", "rejected")...).
			AddRow(statRow(3, 500, 1, 901, "b", "accepted")...).
			AddRow(statRow(4, 500, 1, 901, "b", "ungraded")...).
			AddRow(statRow(5, 500, 1, 901, "b", "ungraded")...))

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
	if len(resp.Problems) != 2 {
		t.Fatalf("want 2 subproblem lines, got %d", len(resp.Problems))
	}

	a := resp.Problems[0]
	if a.SubproblemID != 900 || a.SubproblemLabel != "a" || a.ProblemDisplay != "Задача 1" {
		t.Errorf("subproblem a header wrong: %+v", a)
	}
	if a.Accepted != 1 || a.Appealed != 1 || a.Rejected != 1 || a.Submitted != 1 || a.Unsolved != 1 {
		t.Errorf("a buckets = a%d ap%d r%d s%d u%d, want 1/1/1/1/1", a.Accepted, a.Appealed, a.Rejected, a.Submitted, a.Unsolved)
	}

	b := resp.Problems[1]
	if b.SubproblemID != 901 || b.SubproblemLabel != "b" {
		t.Errorf("subproblem b header wrong: %+v", b)
	}
	if b.Accepted != 2 || b.Appealed != 0 || b.Rejected != 1 || b.Submitted != 0 || b.Unsolved != 2 {
		t.Errorf("b buckets = a%d ap%d r%d s%d u%d, want 2/0/1/0/2", b.Accepted, b.Appealed, b.Rejected, b.Submitted, b.Unsolved)
	}

	for _, p := range resp.Problems {
		if sum := p.Accepted + p.Appealed + p.Rejected + p.Submitted + p.Unsolved; sum != resp.TotalStudents {
			t.Errorf("subproblem %d buckets sum %d != total_students %d", p.SubproblemID, sum, resp.TotalStudents)
		}
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

	// Problem 1 (id 500) has subproblems a=900, b=901; problem 2 (id 501) has a
	// single sentinel subproblem 950 (label ''). Two students. Rows arrive in
	// (problem number, subproblem label) order from SQL.
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "a", "accepted")...).
			AddRow(statRow(2, 500, 1, 900, "a", "submitted")...).
			AddRow(statRow(1, 500, 1, 901, "b", "accepted")...).
			AddRow(statRow(2, 500, 1, 901, "b", "accepted")...).
			AddRow(statRow(1, 501, 2, 950, "", "rejected")...).
			AddRow(statRow(2, 501, 2, 950, "", "ungraded")...))

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
	if len(resp.Problems) != 3 {
		t.Fatalf("want 3 subproblem lines, got %d", len(resp.Problems))
	}
	if resp.Problems[0].SubproblemID != 900 || resp.Problems[1].SubproblemID != 901 || resp.Problems[2].SubproblemID != 950 {
		t.Fatalf("subproblems not ordered: %d, %d, %d", resp.Problems[0].SubproblemID, resp.Problems[1].SubproblemID, resp.Problems[2].SubproblemID)
	}
	if resp.Problems[2].SubproblemLabel != "" || resp.Problems[2].ProblemNumber != 2 {
		t.Errorf("sentinel subproblem wrong: %+v", resp.Problems[2])
	}
	if resp.Problems[0].Accepted != 1 || resp.Problems[0].Submitted != 1 {
		t.Errorf("subproblem 900 buckets wrong: %+v", resp.Problems[0])
	}
	if resp.Problems[1].Accepted != 2 {
		t.Errorf("subproblem 901 buckets wrong: %+v", resp.Problems[1])
	}
	if resp.Problems[2].Rejected != 1 || resp.Problems[2].Unsolved != 1 {
		t.Errorf("subproblem 950 buckets wrong: %+v", resp.Problems[2])
	}
	for _, p := range resp.Problems {
		if sum := p.Accepted + p.Appealed + p.Rejected + p.Submitted + p.Unsolved; sum != resp.TotalStudents {
			t.Errorf("subproblem %d buckets sum %d != total %d", p.SubproblemID, sum, resp.TotalStudents)
		}
	}
}

// A teacher must see the full problem structure before any student is enrolled:
// the SQL emits one placeholder row per subproblem (student_user_id NULL), and
// the handler reports them with zero counts and total_students 0.
func TestProblemStats_EmptyRosterShowsProblems(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSeriesForStats(mock, 100, 42, now)
	expectTeacherCheck(mock, 3, 42, true)

	// Two subproblems, no roster: one placeholder row each.
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(emptyRosterRow(500, 1, 900, "a")...).
			AddRow(emptyRosterRow(500, 1, 901, "b")...))

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
	if resp.TotalStudents != 0 {
		t.Errorf("total_students = %d, want 0", resp.TotalStudents)
	}
	if len(resp.Problems) != 2 {
		t.Fatalf("want 2 subproblem lines even with no students, got %d", len(resp.Problems))
	}
	for _, p := range resp.Problems {
		if p.Accepted+p.Appealed+p.Rejected+p.Submitted+p.Unsolved != 0 {
			t.Errorf("subproblem %d should have all-zero buckets: %+v", p.SubproblemID, p)
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
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemStatsRowColumns).
			AddRow(statRow(1, 500, 1, 900, "a", "accepted")...))

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
