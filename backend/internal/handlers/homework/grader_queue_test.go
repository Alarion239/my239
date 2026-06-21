package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestGraderQueue_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	// GetSeries (we reuse the math_center_series columns).
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	expectTeacherCheck(mock, 3, 42, true)

	mock.ExpectQuery(`FROM homework_thread t\s+JOIN users u`).
		WithArgs(int64(100), int64(3), false).
		WillReturnRows(mock.NewRows(queueRowColumns).
			AddRow(int64(1), int64(7), int64(900), int64(100), int64(42),
				"submitted", (*int64)(nil), (*int64)(nil), (*time.Time)(nil), now,
				"Аня", (*string)(nil), "Иванова", "a", int32(1)).
			AddRow(int64(2), int64(8), int64(901), int64(100), int64(42),
				"appealed", ptr64(3), (*int64)(nil), (*time.Time)(nil), now,
				"Боря", (*string)(nil), "Петров", "b", int32(2)))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/queue", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var items []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &items)
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	if items[0]["student_name"] != "Аня Иванова" {
		t.Errorf("student name: %v", items[0]["student_name"])
	}
	if items[1]["problem_display"] != "Задача 2" {
		t.Errorf("problem display: %v", items[1]["problem_display"])
	}
}

func TestGraderQueue_MineQueryParam(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	expectTeacherCheck(mock, 3, 42, true)

	// ?mine=true must reach the SQL with mine_only=true.
	mock.ExpectQuery(`FROM homework_thread t\s+JOIN users u`).
		WithArgs(int64(100), int64(3), true).
		WillReturnRows(mock.NewRows(queueRowColumns))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/queue?mine=true", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

// TestGraderQueue_AdminNotEnrolledAllowed proves requireTeacher treats an
// admin as a teacher superset: no IsTeacherInCenter query runs (the admin
// short-circuits it) yet the request succeeds for a center the admin is not
// enrolled in.
func TestGraderQueue_AdminNotEnrolledAllowed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	// NOTE: deliberately no expectTeacherCheck — an admin must not trigger it.
	mock.ExpectQuery(`FROM homework_thread t\s+JOIN users u`).
		WithArgs(int64(100), int64(99), false).
		WillReturnRows(mock.NewRows(queueRowColumns))

	// userID 99 is an admin (isAdmin=true) but enrolled in no center.
	req := authedRequest(t, access, 99, true, http.MethodGet, "/series/100/queue", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations (admin should not run a teacher check): %v", err)
	}
}

func TestGraderQueue_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/series/100/queue", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
