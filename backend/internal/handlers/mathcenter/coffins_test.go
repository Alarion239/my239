package mathcenter_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// Full math_center_subproblem_solutions row, in SELECT * order.
var subproblemSolutionColumns = []string{
	"id", "subproblem_id", "is_coffin", "released_at",
	"solution_tex_source", "solution_pdf_object_key", "solution_link",
	"created_at", "updated_at",
}

// GetSubproblemSolutionCenter resolution row (subproblem → problem → series → center).
var subproblemCenterColumns = []string{
	"subproblem_id", "subproblem_label", "problem_id", "problem_number",
	"series_id", "math_center_id", "series_due_at",
}

func expectSubproblemCenter(mock pgxmock.PgxPoolIface, subproblemID, centerID int64, label string, problemNumber int32, now time.Time) {
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(subproblemID).
		WillReturnRows(mock.NewRows(subproblemCenterColumns).
			AddRow(subproblemID, label, int64(500), problemNumber, int64(100), centerID, now))
}

func TestMarkCoffin_AdminSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemCenter(mock, 900, 42, "b", 5, now)
	mock.ExpectQuery(`INSERT INTO math_center_subproblem_solutions`).
		WithArgs(int64(900), true).
		WillReturnRows(mock.NewRows(subproblemSolutionColumns).
			AddRow(int64(9), int64(900), true, (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now, now))

	req := authedAdminRequest(t, access, 1, http.MethodPost, "/subproblems/900/coffin", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["subproblem_id"] != float64(900) || resp["is_coffin"] != true {
		t.Errorf("unexpected coffin view: %v", resp)
	}
}

func TestMarkCoffin_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemCenter(mock, 900, 42, "b", 5, now)
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))

	req := authedRequest(t, access, 7, http.MethodPost, "/subproblems/900/coffin", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestReleaseCoffin_AdminSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemCenter(mock, 900, 42, "b", 5, now)
	mock.ExpectQuery(`UPDATE math_center_subproblem_solutions\s+SET released_at`).
		WithArgs(int64(900)).
		WillReturnRows(mock.NewRows(subproblemSolutionColumns).
			AddRow(int64(9), int64(900), true, &now, (*string)(nil), (*string)(nil), (*string)(nil), now, now))

	req := authedAdminRequest(t, access, 1, http.MethodPost, "/subproblems/900/solution/release", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["released_at"] == nil {
		t.Errorf("expected released_at set, got %v", resp)
	}
}

func TestListCenterCoffins_AdminReturnsRows(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss\s+JOIN math_center_subproblems`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{
			"subproblem_id", "is_coffin", "released_at", "solution_tex_source",
			"solution_pdf_object_key", "solution_link", "created_at",
			"subproblem_label", "problem_id", "problem_number",
			"series_id", "series_number", "series_name", "series_due_at", "math_center_id",
		}).
			AddRow(int64(901), true, (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now,
				"b", int64(500), int32(4), int64(100), int32(2), "Геометрия", now, int64(42)))

	req := authedAdminRequest(t, access, 1, http.MethodGet, "/centers/42/coffins", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp) != 1 || resp[0]["display"] != "Задача 4 (b)" || resp[0]["subproblem_id"] != float64(901) {
		t.Errorf("unexpected coffins list: %v", resp)
	}
}
