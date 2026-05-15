package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

var gridRowColumns = []string{
	"student_user_id", "student_first_name", "student_middle_name", "student_last_name",
	"group_id", "group_name",
	"subproblem_id", "subproblem_label", "problem_id", "problem_number",
	"thread_id", "current_status", "last_grader_user_id",
	"claim_holder_user_id", "claim_expires_at", "thread_updated_at",
}

func TestTeacherGrid_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now))
	expectTeacherCheck(mock, 3, 42, true)

	// 2 students × 2 subproblems = 4 rows. Student A has submitted task 1a;
	// everything else is ungraded.
	mock.ExpectQuery(`FROM math_center_students mcs\s+JOIN users u`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(gridRowColumns).
			// Student A, subproblem a, submitted
			AddRow(int64(7), "Аня", (*string)(nil), "Иванова", int64(10), "А",
				int64(900), "a", int64(500), int32(1),
				int64(1), "submitted", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), &now).
			// Student A, subproblem b, ungraded
			AddRow(int64(7), "Аня", (*string)(nil), "Иванова", int64(10), "А",
				int64(901), "b", int64(500), int32(1),
				int64(0), "ungraded", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), (*time.Time)(nil)).
			// Student B, subproblem a, ungraded
			AddRow(int64(8), "Боря", (*string)(nil), "Петров", int64(10), "А",
				int64(900), "a", int64(500), int32(1),
				int64(0), "ungraded", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), (*time.Time)(nil)).
			// Student B, subproblem b, ungraded
			AddRow(int64(8), "Боря", (*string)(nil), "Петров", int64(10), "А",
				int64(901), "b", int64(500), int32(1),
				int64(0), "ungraded", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), (*time.Time)(nil)))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/grid", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Columns []struct {
			SubproblemID    int64  `json:"subproblem_id"`
			SubproblemLabel string `json:"subproblem_label"`
			ProblemNumber   int    `json:"problem_number"`
			ProblemDisplay  string `json:"problem_display"`
		} `json:"columns"`
		Students []struct {
			StudentName string `json:"student_name"`
			Cells       []struct {
				ThreadID      int64  `json:"thread_id"`
				CurrentStatus string `json:"current_status"`
			} `json:"cells"`
		} `json:"students"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.Columns) != 2 {
		t.Fatalf("want 2 columns, got %d", len(resp.Columns))
	}
	if resp.Columns[0].ProblemDisplay != "Задача 1" {
		t.Errorf("column 0 problem display: %v", resp.Columns[0].ProblemDisplay)
	}
	if len(resp.Students) != 2 {
		t.Fatalf("want 2 students, got %d", len(resp.Students))
	}
	if resp.Students[0].StudentName != "Аня Иванова" {
		t.Errorf("student 0 name: %v", resp.Students[0].StudentName)
	}
	if len(resp.Students[0].Cells) != 2 {
		t.Fatalf("want 2 cells per student, got %d", len(resp.Students[0].Cells))
	}
	if resp.Students[0].Cells[0].CurrentStatus != "submitted" || resp.Students[0].Cells[0].ThreadID != 1 {
		t.Errorf("student 0 cell 0 wrong: %+v", resp.Students[0].Cells[0])
	}
	if resp.Students[0].Cells[1].CurrentStatus != "ungraded" || resp.Students[0].Cells[1].ThreadID != 0 {
		t.Errorf("student 0 cell 1 wrong: %+v", resp.Students[0].Cells[1])
	}
}

func TestTeacherGrid_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now))
	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/grid", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
