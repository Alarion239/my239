package homework_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var centerGridRosterColumns = []string{
	"group_id", "group_name", "student_user_id", "student_first_name", "student_last_name", "has_student_comment",
}

var centerGridColumnColumns = []string{
	"series_id", "series_number", "series_name", "series_due_at",
	"subproblem_id", "subproblem_label", "problem_id", "problem_number", "is_coffin", "coffin_released_at",
}

var centerGridCellColumns = []string{
	"student_user_id", "subproblem_id", "thread_id", "current_status", "last_grader_user_id", "last_grader_name",
	"grader_first_name", "grader_last_name", "claim_holder_user_id", "claim_expires_at", "has_internal_comment",
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
	mock.ExpectBeginTx(pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	mock.ExpectQuery(`FROM math_center_groups g`).
		WithArgs(int64(42), int64(5)).
		WillReturnRows(mock.NewRows(centerGridRosterColumns).
			AddRow(int64(10), "А", int64(7), "Аня", "Иванова", true))
	mock.ExpectQuery(`FROM math_center_series s`).
		WithArgs(int64(42), int64(5)).
		WillReturnRows(mock.NewRows(centerGridColumnColumns).
			// Series 1, problem 0 (У), no subparts.
			AddRow(int64(100), int32(0), "Алгебра", due,
				int64(900), "", int64(500), int32(0), true, (*time.Time)(nil)).
			// Series 1, problem 1, subpart a.
			AddRow(int64(100), int32(0), "Алгебра", due,
				int64(901), "a", int64(501), int32(1), false, (*time.Time)(nil)).
			// Series 2, problem 1, no subparts.
			AddRow(int64(200), int32(2), "Геометрия", due,
				int64(910), "", int64(600), int32(1), false, (*time.Time)(nil)))
	mock.ExpectQuery(`FROM homework_thread t`).
		WithArgs(int64(42), int64(5)).
		WillReturnRows(mock.NewRows(centerGridCellColumns).
			// Accepted by ПС, with an internal comment.
			AddRow(int64(7), int64(900), int64(1), "accepted", &graderID, "", &grFirst, &grLast, (*int64)(nil), (*time.Time)(nil), true).
			// Existing ungraded thread remains present in the sparse cache.
			AddRow(int64(7), int64(901), int64(3), "ungraded", (*int64)(nil), "", (*string)(nil), (*string)(nil), (*int64)(nil), (*time.Time)(nil), false).
			// Offline accepted with a free-text grader and no comment.
			AddRow(int64(7), int64(910), int64(2), "accepted", (*int64)(nil), "Анна А", (*string)(nil), (*string)(nil), (*int64)(nil), (*time.Time)(nil), false))
	mock.ExpectQuery(`FROM math_center_student_name_color`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{"student_user_id", "background_hex"}))
	mock.ExpectCommit()

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid?term_id=5", nil)
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
			ThreadID           int64  `json:"thread_id"`
			CurrentStatus      string `json:"current_status"`
			HasInternalComment bool   `json:"has_internal_comment"`
		} `json:"cells"`
		Graders map[string]string `json:"graders"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)

	if len(resp.Groups) != 1 || resp.Groups[0].Name != "А" {
		t.Fatalf("groups: %+v", resp.Groups)
	}
	if len(resp.Groups[0].Students) != 1 || resp.Groups[0].Students[0].Name != "Иванова Аня" {
		t.Fatalf("students: %+v", resp.Groups[0].Students)
	}
	if len(resp.Series) != 2 {
		t.Fatalf("series count: got %d, want 2", len(resp.Series))
	}
	// Series 1 has two columns: the sentinel for problem 0 ("У") and
	// subpart a of problem 1 ("1a").
	if len(resp.Series[0].Columns) != 2 {
		t.Fatalf("series 0 columns: %+v", resp.Series[0].Columns)
	}
	if resp.Series[0].Columns[0].ColumnLabel != "У" {
		t.Errorf("col 0 label: got %q, want У", resp.Series[0].Columns[0].ColumnLabel)
	}
	if resp.Series[0].Columns[1].ColumnLabel != "1a" {
		t.Errorf("col 1 label: got %q, want 1a", resp.Series[0].Columns[1].ColumnLabel)
	}
	if resp.Series[1].Columns[0].ColumnLabel != "1" {
		t.Errorf("series 1 col 0 label: got %q, want 1", resp.Series[1].Columns[0].ColumnLabel)
	}
	// Existing threads, including ungraded ones, are present.
	if c, ok := resp.Cells["7:900"]; !ok || c.ThreadID != 1 || c.CurrentStatus != "accepted" {
		t.Errorf("cell 7:900: %+v ok=%v", c, ok)
	}
	if c, ok := resp.Cells["7:901"]; !ok || c.ThreadID != 3 || c.CurrentStatus != "ungraded" {
		t.Errorf("cell 7:901: %+v ok=%v", c, ok)
	}
	if c, ok := resp.Cells["7:910"]; !ok || c.ThreadID != 2 || c.HasInternalComment {
		t.Errorf("cell 7:910: %+v ok=%v", c, ok)
	}
	if bytes.Contains(rr.Body.Bytes(), []byte(`"has_internal_comment":false`)) {
		t.Error("false cell comment flags should be omitted from the large grid payload")
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

func TestGetCenterGrid_RollsBackAfterSnapshotStageFailure(t *testing.T) {
	t.Parallel()
	stages := []struct {
		name  string
		query string
	}{
		{name: "roster", query: `FROM math_center_groups g`},
		{name: "columns", query: `FROM math_center_series s`},
		{name: "cells", query: `FROM homework_thread t`},
	}

	for _, stage := range stages {
		t.Run(stage.name, func(t *testing.T) {
			mock, _ := pgxmock.NewPool()
			defer mock.Close()
			r, access, _ := newRouter(t, mock)
			expectTeacherCheck(mock, 3, 42, true)
			mock.ExpectBeginTx(pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
			if stage.name == "columns" {
				mock.ExpectQuery(`FROM math_center_groups g`).
					WithArgs(int64(42), int64(5)).
					WillReturnRows(mock.NewRows(centerGridRosterColumns))
			}
			if stage.name == "cells" {
				mock.ExpectQuery(`FROM math_center_groups g`).
					WithArgs(int64(42), int64(5)).
					WillReturnRows(mock.NewRows(centerGridRosterColumns))
				mock.ExpectQuery(`FROM math_center_series s`).
					WithArgs(int64(42), int64(5)).
					WillReturnRows(mock.NewRows(centerGridColumnColumns))
			}
			mock.ExpectQuery(stage.query).
				WithArgs(int64(42), int64(5)).
				WillReturnError(errors.New("snapshot stage failed"))
			mock.ExpectRollback()

			req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid?term_id=5", nil)
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusInternalServerError {
				t.Fatalf("got %d, want 500; body=%s", rr.Code, rr.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mock expectations: %v", err)
			}
		})
	}
}

func TestGetCenterGridSeriesCells_Empty(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	expectTeacherCheck(mock, 3, 42, true)
	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`FROM homework_thread t`).
		WithArgs(int64(42), int64(100)).
		WillReturnRows(mock.NewRows(centerGridCellColumns))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid/series/100/cells", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var response struct {
		SeriesID int64                      `json:"series_id"`
		Cells    map[string]json.RawMessage `json:"cells"`
		Graders  map[string]string          `json:"graders"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.SeriesID != 100 || len(response.Cells) != 0 || len(response.Graders) != 0 {
		t.Fatalf("response: %+v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mock expectations: %v", err)
	}
}

func TestGetCenterGridSeriesCells_WrongCenterNotFound(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	expectTeacherCheck(mock, 3, 42, true)
	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(99), int32(1), "S", now, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/grid/series/100/cells", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("mock expectations: %v", err)
	}
}
