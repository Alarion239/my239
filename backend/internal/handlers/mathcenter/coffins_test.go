package mathcenter_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

var coffinColumns = []string{
	"id", "problem_id", "released_at", "solution_tex_source",
	"solution_pdf_object_key", "solution_link", "created_at", "updated_at",
}

func TestMarkCoffin_AdminSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`FROM math_center_problems p\s+JOIN math_center_series`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows([]string{"problem_id", "series_id", "math_center_id"}).
			AddRow(int64(500), int64(100), int64(42)))
	mock.ExpectQuery(`INSERT INTO math_center_coffins`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows(coffinColumns).
			AddRow(int64(9), int64(500), (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now, now))

	req := authedAdminRequest(t, access, 1, http.MethodPost, "/problems/500/coffin", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["id"] != float64(9) || resp["problem_id"] != float64(500) {
		t.Errorf("unexpected coffin view: %v", resp)
	}
}

func TestMarkCoffin_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	mock.ExpectQuery(`FROM math_center_problems p\s+JOIN math_center_series`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows([]string{"problem_id", "series_id", "math_center_id"}).
			AddRow(int64(500), int64(100), int64(42)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))

	req := authedRequest(t, access, 7, http.MethodPost, "/problems/500/coffin", nil)
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
	mock.ExpectQuery(`FROM math_center_coffins c\s+JOIN math_center_problems`).
		WithArgs(int64(9)).
		WillReturnRows(mock.NewRows([]string{"coffin_id", "problem_id", "math_center_id"}).
			AddRow(int64(9), int64(500), int64(42)))
	mock.ExpectQuery(`FROM math_center_coffins\s+WHERE id`).
		WithArgs(int64(9)).
		WillReturnRows(mock.NewRows(coffinColumns).
			AddRow(int64(9), int64(500), (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now, now))
	mock.ExpectQuery(`UPDATE math_center_coffins\s+SET released_at`).
		WithArgs(int64(9)).
		WillReturnRows(mock.NewRows(coffinColumns).
			AddRow(int64(9), int64(500), &now, (*string)(nil), (*string)(nil), (*string)(nil), now, now))

	req := authedAdminRequest(t, access, 1, http.MethodPost, "/coffins/9/release", nil)
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
	mock.ExpectQuery(`FROM math_center_coffins c\s+JOIN math_center_problems`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{
			"id", "problem_id", "released_at", "solution_tex_source",
			"solution_pdf_object_key", "solution_link", "created_at",
			"problem_number", "series_id", "series_number", "series_name", "math_center_id",
		}).
			AddRow(int64(9), int64(500), (*time.Time)(nil), (*string)(nil), (*string)(nil), (*string)(nil), now,
				int32(4), int64(100), int32(2), "Геометрия", int64(42)))

	req := authedAdminRequest(t, access, 1, http.MethodGet, "/centers/42/coffins", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp) != 1 || resp[0]["problem_display"] != "Задача 4" {
		t.Errorf("unexpected coffins list: %v", resp)
	}
}
