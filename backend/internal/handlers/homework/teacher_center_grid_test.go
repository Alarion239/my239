package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

var centerGridColumns = []string{
	"series_id", "series_number", "series_name", "series_due_at",
	"student_user_id", "student_first_name", "student_middle_name", "student_last_name",
	"group_id", "group_name",
	"subproblem_id", "subproblem_label", "problem_id", "problem_number", "is_coffin",
	"coffin_released_at",
	"thread_id", "current_status", "last_grader_user_id",
	"grader_first_name", "grader_last_name",
	"claim_holder_user_id", "claim_expires_at",
}

func TestGetCenterGrid_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, true)

	now := time.Now()
	due := now.Add(time.Hour)
	graderID := int64(3)
	grFirst, grLast := "Пётр", "Сидоров"
	mock.ExpectQuery(`FROM math_center_students mcs\s+JOIN users u`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(centerGridColumns).
			// Series 1, problem 0 (Упр), no subparts, student A — ACCEPTED by ПС.
			AddRow(int64(100), int32(0), "Алгебра", due,
				int64(7), "Аня", (*string)(nil), "Иванова",
				int64(10), "А",
				int64(900), "", int64(500), int32(0), true, (*time.Time)(nil),
				int64(1), "accepted", &graderID, &grFirst, &grLast, (*int64)(nil), (*time.Time)(nil)).
			// Series 1, problem 1, subpart a, student A
			AddRow(int64(100), int32(0), "Алгебра", due,
				int64(7), "Аня", (*string)(nil), "Иванова",
				int64(10), "А",
				int64(901), "a", int64(501), int32(1), false, (*time.Time)(nil),
				int64(0), "ungraded", (*int64)(nil), (*string)(nil), (*string)(nil), (*int64)(nil), (*time.Time)(nil)).
			// Series 2, problem 1, no subparts, student A
			AddRow(int64(200), int32(2), "Геометрия", due,
				int64(7), "Аня", (*string)(nil), "Иванова",
				int64(10), "А",
				int64(910), "", int64(600), int32(1), false, (*time.Time)(nil),
				int64(0), "ungraded", (*int64)(nil), (*string)(nil), (*string)(nil), (*int64)(nil), (*time.Time)(nil)))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Groups []struct {
			GroupID  int64  `json:"group_id"`
			Name     string `json:"name"`
			Students []struct {
				UserID int64  `json:"user_id"`
				Name   string `json:"name"`
			} `json:"students"`
		} `json:"groups"`
		Series []struct {
			SeriesID    int64  `json:"series_id"`
			DisplayName string `json:"display_name"`
			Columns     []struct {
				SubproblemID  int64  `json:"subproblem_id"`
				ColumnLabel   string `json:"column_label"`
				ProblemNumber int    `json:"problem_number"`
			} `json:"columns"`
		} `json:"series"`
		Cells map[string]struct {
			ThreadID      int64  `json:"thread_id"`
			CurrentStatus string `json:"current_status"`
		} `json:"cells"`
		Graders map[string]string `json:"graders"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)

	if len(resp.Groups) != 1 || resp.Groups[0].Name != "А" {
		t.Fatalf("groups: %+v", resp.Groups)
	}
	if len(resp.Groups[0].Students) != 1 || resp.Groups[0].Students[0].Name != "Аня Иванова" {
		t.Fatalf("students: %+v", resp.Groups[0].Students)
	}
	if len(resp.Series) != 2 {
		t.Fatalf("series count: got %d, want 2", len(resp.Series))
	}
	// Series 1 has two columns: the sentinel for problem 0 ("Упр") and
	// subpart a of problem 1 ("1a").
	if len(resp.Series[0].Columns) != 2 {
		t.Fatalf("series 0 columns: %+v", resp.Series[0].Columns)
	}
	if resp.Series[0].Columns[0].ColumnLabel != "Упр" {
		t.Errorf("col 0 label: got %q, want Упр", resp.Series[0].Columns[0].ColumnLabel)
	}
	if resp.Series[0].Columns[1].ColumnLabel != "1a" {
		t.Errorf("col 1 label: got %q, want 1a", resp.Series[0].Columns[1].ColumnLabel)
	}
	if resp.Series[1].Columns[0].ColumnLabel != "1" {
		t.Errorf("series 1 col 0 label: got %q, want 1", resp.Series[1].Columns[0].ColumnLabel)
	}
	// Cells: only the (7, 900) thread is non-empty.
	if c, ok := resp.Cells["7:900"]; !ok || c.ThreadID != 1 || c.CurrentStatus != "accepted" {
		t.Errorf("cell 7:900: %+v ok=%v", c, ok)
	}
	if _, ok := resp.Cells["7:901"]; ok {
		t.Error("cell 7:901 should be absent (ungraded)")
	}
	// The grader of the accepted cell is exposed by initials for the Кондуит.
	if resp.Graders["3"] != "ПС" {
		t.Errorf("grader initials: got %q, want ПС", resp.Graders["3"])
	}
}

func TestGetCenterGrid_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
