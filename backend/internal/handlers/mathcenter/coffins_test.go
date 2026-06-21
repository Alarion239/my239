package mathcenter_test

import (
	"bytes"
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
	"created_at", "updated_at", "solution_group_id",
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
			AddRow(int64(9), int64(900), true, (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now, now, (*int64)(nil)))

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
			AddRow(int64(9), int64(900), true, &now, (*string)(nil), (*string)(nil), (*string)(nil), now, now, (*int64)(nil)))

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

func TestListCoffinQueue_AdminReturnsRows(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`FROM homework_thread t\s+JOIN math_center_subproblem_solutions ss`).
		WithArgs(int64(42), int64(1)).
		WillReturnRows(mock.NewRows([]string{
			"thread_id", "student_user_id", "subproblem_id", "series_id",
			"current_status", "last_grader_user_id", "claim_holder_user_id",
			"claim_expires_at", "updated_at",
			"student_first_name", "student_middle_name", "student_last_name",
			"subproblem_label", "problem_number",
		}).
			AddRow(int64(55), int64(7), int64(901), int64(100),
				"submitted", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), now,
				"Аня", (*string)(nil), "Иванова", "b", int32(4)))

	req := authedAdminRequest(t, access, 1, http.MethodGet, "/centers/42/coffin-queue", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp) != 1 || resp[0]["student_name"] != "Аня Иванова" || resp[0]["series_id"] != float64(100) {
		t.Errorf("unexpected coffin queue: %v", resp)
	}
}

func TestAssignSolutionGroup_AdminSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	// Authorize via the first subproblem's center.
	expectSubproblemCenter(mock, 900, 42, "a", 5, now)
	// Mint a group, then assign it to the whole set.
	mock.ExpectQuery(`INSERT INTO math_center_solution_groups`).
		WillReturnRows(mock.NewRows([]string{"id"}).AddRow(int64(7)))
	mock.ExpectExec(`UPDATE math_center_subproblem_solutions\s+SET solution_group_id`).
		WithArgs(int64(7), []int64{900, 901}).
		WillReturnResult(pgxmock.NewResult("UPDATE", 2))

	body, _ := json.Marshal(map[string]any{"subproblem_ids": []int64{900, 901}})
	req := authedAdminRequest(t, access, 1, http.MethodPost, "/subproblem-solutions/group", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["group_id"] != float64(7) {
		t.Errorf("group_id: got %v, want 7", resp["group_id"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestAssignSolutionGroup_EmptyRejected(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	body, _ := json.Marshal(map[string]any{"subproblem_ids": []int64{}})
	req := authedAdminRequest(t, access, 1, http.MethodPost, "/subproblem-solutions/group", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400", rr.Code)
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
	// Teachers (admin) also get the per-coffin solved counts.
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss\s+JOIN math_center_subproblems sp[\s\S]*GROUP BY`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{"subproblem_id", "accepted", "total"}).
			AddRow(int64(901), int64(3), int64(10)))

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
	if resp[0]["accepted_count"] != float64(3) || resp[0]["total_count"] != float64(10) {
		t.Errorf("solved counts: got %v / %v, want 3 / 10", resp[0]["accepted_count"], resp[0]["total_count"])
	}
}
