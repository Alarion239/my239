package mathcenter_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// Column lists matching the sqlc `SELECT *` shapes the manage handlers use.
var (
	manageGroupColumns   = []string{"id", "math_center_id", "name", "created_at"}
	manageTeacherColumns = []string{"id", "user_id", "math_center_id", "is_head_teacher", "created_at"}
	manageStudentColumns = []string{"id", "user_id", "group_id", "created_at", "can_view_razbors"}
	manageCenterColumns  = []string{"id", "graduation_year", "created_at"}
	manageTermColumns    = []string{
		"id", "math_center_id", "kind", "grade", "is_active", "created_at", "archived_at",
	}
	manageTokenColumns = []string{
		"id", "token", "description", "max_uses", "expires_at", "created_at", "preset", "math_center_id",
	}
)

// expectHeadCheck mocks IsHeadTeacherInCenter for a non-admin caller.
func expectHeadCheck(mock pgxmock.PgxPoolIface, userID, centerID int64, isHead bool) {
	mock.ExpectQuery(`AND is_head_teacher = TRUE`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_head_teacher"}).AddRow(isHead))
}

func TestManage_NonHeadTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectHeadCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, http.MethodGet, "/centers/42/manage/groups", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_ListGroupsAdmin(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	// Admin token → callerIsAdmin bypass, no head-teacher query.
	mock.ExpectQuery(`FROM math_center_groups g\s+WHERE g.math_center_id = \$1`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageGroupColumns).
			AddRow(int64(1), int64(42), "А", now))

	req := authedAdminRequest(t, access, 9, http.MethodGet, "/centers/42/manage/groups", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_RosterBoardSnapshot(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	activeGrade := int32(6)
	previousGrade := int32(5)
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+AND is_active = TRUE`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageTermColumns).
			AddRow(int64(20), int64(42), "academic", &activeGrade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+ORDER BY`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageTermColumns).
			AddRow(int64(20), int64(42), "academic", &activeGrade, true, now, (*time.Time)(nil)).
			AddRow(int64(19), int64(42), "academic", &previousGrade, false, now.Add(-24*time.Hour), (*time.Time)(nil)))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE term_id = \$1`).
		WithArgs(int64(20)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "name", "created_at", "term_id"}).
			AddRow(int64(1), int64(42), "А", now, int64(20)))
	mock.ExpectQuery(`SELECT \(SELECT id FROM active_term\)`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{"active_term_id", "published_series_count", "rating_term_id"}).
			AddRow(int64(20), int64(3), int64(20)))
	mock.ExpectQuery(`WITH active_term AS`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{
			"student_id", "user_id", "current_group_id", "previous_group_id", "previous_group_name",
			"previous_term_enrolled", "first_name", "middle_name", "last_name", "rating", "published_series_count", "rating_term_id",
		}).AddRow(int64(55), int64(101), nil, nil, nil, false, "Ира", nil, "Петрова", float64(4), int64(3), int64(19)))

	req := authedAdminRequest(t, access, 9, http.MethodGet, "/centers/42/manage/roster-board", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var body struct {
		PublishedSeriesCount int `json:"published_series_count"`
		Groups               []struct {
			ID int64 `json:"id"`
		} `json:"groups"`
		Students []struct {
			StudentID      int64   `json:"student_id"`
			UserID         int64   `json:"user_id"`
			CurrentGroupID *int64  `json:"current_group_id"`
			Rating         float64 `json:"rating"`
		} `json:"students"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.PublishedSeriesCount != 3 || len(body.Groups) != 1 || len(body.Students) != 1 ||
		body.Students[0].StudentID != 55 || body.Students[0].UserID != 101 || body.Students[0].CurrentGroupID != nil || body.Students[0].Rating != 4 {
		t.Fatalf("unexpected board snapshot: %#v", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestManage_RemoveActiveStudent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	mock.ExpectExec(`DELETE FROM math_center_students student\s+USING math_center_groups group_row, math_center_terms term_row`).
		WithArgs(int64(55), int64(42)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	req := authedAdminRequest(t, access, 9, http.MethodDelete, "/centers/42/manage/students/55", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestManage_RemoveStudentRejectsNonActiveOrForeignEnrollment(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	mock.ExpectExec(`DELETE FROM math_center_students student\s+USING math_center_groups group_row, math_center_terms term_row`).
		WithArgs(int64(55), int64(42)).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))

	req := authedAdminRequest(t, access, 9, http.MethodDelete, "/centers/42/manage/students/55", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestManage_UnallocateStudentByUserIsIdempotent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	grade := int32(6)
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+AND is_active = TRUE`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageTermColumns).
			AddRow(int64(20), int64(42), "academic", &grade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`FROM users\s+WHERE id = \$1`).
		WithArgs(int64(101)).
		WillReturnRows(mock.NewRows([]string{
			"id", "username", "password_hash", "first_name", "middle_name", "last_name",
			"invitation_token_id", "created_at", "updated_at", "is_admin", "is_math_center",
		}).AddRow(int64(101), "ira", "", "Ира", nil, "Петрова", nil, now, now, false, false))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE term_id = \$1`).
		WithArgs(int64(20)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "name", "created_at", "term_id"}).
			AddRow(int64(30), int64(42), "Не распределены", now, int64(20)))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(30)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "term_id"}).
			AddRow(int64(30), int64(42), int64(20)))
	mock.ExpectQuery(`FROM math_center_teachers`).
		WithArgs(int64(101), int64(42)).
		WillReturnRows(mock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`FROM math_center_students student\s+JOIN math_center_groups group_row`).
		WithArgs(int64(101), int64(42)).
		WillReturnRows(mock.NewRows([]string{"id", "user_id", "group_id", "term_id", "can_view_razbors", "razbor_default_video", "razbor_default_pdf_tex"}).
			AddRow(int64(55), int64(101), int64(30), int64(20), true, false, false))

	req := authedAdminRequest(t, access, 9, http.MethodPut, "/centers/42/manage/students/101/group", strings.NewReader(`{"group_id":null}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestManage_ListGroupsForArchivedTerm(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE id = \$1`).
		WithArgs(int64(70)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "kind", "grade", "is_active", "created_at", "archived_at"}).
			AddRow(int64(70), int64(42), "academic", (*int32)(nil), false, now, (*time.Time)(nil)))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE term_id = \$1`).
		WithArgs(int64(70)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "name", "created_at", "term_id"}).
			AddRow(int64(16), int64(42), "16", now, int64(70)))

	req := authedAdminRequest(t, access, 9, http.MethodGet, "/centers/42/manage/groups?term_id=70", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var groups []struct {
		ID     int64 `json:"id"`
		TermID int64 `json:"term_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &groups); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != 16 || groups[0].TermID != 70 {
		t.Fatalf("groups = %#v, want archived group 16 in term 70", groups)
	}
}

func TestManage_CreateGroup(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	grade := int32(5)
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT graduation_year FROM math_centers`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{"graduation_year"}).AddRow(int32(2032)))
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+AND is_active = TRUE`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageTermColumns).
			AddRow(int64(70), int64(42), "academic", &grade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(70), "Б").
		WillReturnRows(mock.NewRows(append(manageGroupColumns, "term_id")).
			AddRow(int64(7), int64(42), "Б", now, int64(70)))
	mock.ExpectCommit()

	body := strings.NewReader(`{"name":"Б"}`)
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/manage/groups", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_DeleteGroupForeignCenter(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	// The group belongs to a DIFFERENT center → treated as not found.
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(5)).
		WillReturnRows(mock.NewRows(manageGroupColumns).AddRow(int64(5), int64(99), "X", now))

	req := authedRequest(t, access, 3, http.MethodDelete, "/centers/42/manage/groups/5", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_AddTeacherHappy(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM math_center_students s`).
		WithArgs(int64(55), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))
	mock.ExpectQuery(`INSERT INTO math_center_teachers`).
		WithArgs(int64(55), int64(42), false).
		WillReturnRows(mock.NewRows(manageTeacherColumns).AddRow(int64(8), int64(55), int64(42), false, now))
	mock.ExpectCommit()

	body := strings.NewReader(`{"user_id":55,"is_head_teacher":false}`)
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/manage/teachers", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_RemoveLastHeadTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM math_center_teachers\s+WHERE id = \$1`).
		WithArgs(int64(8)).
		WillReturnRows(mock.NewRows(manageTeacherColumns).AddRow(int64(8), int64(3), int64(42), true, now))
	mock.ExpectQuery(`SELECT COUNT\(\*\)\s+FROM math_center_teachers\s+WHERE math_center_id = \$1`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(1)))

	req := authedRequest(t, access, 3, http.MethodDelete, "/centers/42/manage/teachers/8", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_AddStudentForeignGroup(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(5)).
		WillReturnRows(mock.NewRows(manageGroupColumns).AddRow(int64(5), int64(99), "X", now))
	mock.ExpectRollback()

	body := strings.NewReader(`{"user_id":55,"group_id":5}`)
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/manage/students", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_MoveStudent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	// Resolve the student, then its current group (in center), then the target.
	mock.ExpectQuery(`FROM math_center_students\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(manageStudentColumns).AddRow(int64(11), int64(55), int64(1), now, true))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(manageGroupColumns).AddRow(int64(1), int64(42), "А", now))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(2)).
		WillReturnRows(mock.NewRows(manageGroupColumns).AddRow(int64(2), int64(42), "Б", now))
	mock.ExpectExec(`UPDATE math_center_students\s+SET group_id`).
		WithArgs(int64(11), int64(2)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	body := strings.NewReader(`{"group_id":2}`)
	req := authedRequest(t, access, 3, http.MethodPatch, "/centers/42/manage/students/11/group", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_SetStudentRazborAccess(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM math_center_students\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(manageStudentColumns).
			AddRow(int64(11), int64(55), int64(1), now, true))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(manageGroupColumns).
			AddRow(int64(1), int64(42), "А", now))
	mock.ExpectExec(`UPDATE math_center_students\s+SET can_view_razbors`).
		WithArgs(int64(11), false).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	body := strings.NewReader(`{"can_view_razbors":false}`)
	req := authedRequest(t, access, 3, http.MethodPatch, "/centers/42/manage/students/11/razbor-access", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_ListStudentSeriesRazborAccess(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM math_center_students\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(manageStudentColumns).
			AddRow(int64(11), int64(55), int64(1), now, true))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(manageGroupColumns).
			AddRow(int64(1), int64(42), "А", now))
	mock.ExpectQuery(`FROM math_center_students student[\s\S]*JOIN math_center_series series`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows([]string{
			"series_id", "series_number", "series_name", "can_view_video", "can_view_pdf_tex",
		}).AddRow(int64(100), int32(3), "Геометрия", true, false))

	req := authedRequest(t, access, 3, http.MethodGet, "/centers/42/manage/students/11/razbor-access", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(rows) != 1 || rows[0]["can_view_video"] != true || rows[0]["can_view_pdf_tex"] != false {
		t.Fatalf("unexpected access matrix: %v", rows)
	}
}

func TestManage_SetStudentSeriesRazborAccess(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM math_center_students\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(manageStudentColumns).
			AddRow(int64(11), int64(55), int64(1), now, true))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(manageGroupColumns).
			AddRow(int64(1), int64(42), "А", now))
	mock.ExpectExec(`INSERT INTO math_center_student_series_razbor_access`).
		WithArgs(int64(11), int64(100), true, false).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	body := strings.NewReader(`{"can_view_video":true,"can_view_pdf_tex":false}`)
	req := authedRequest(t, access, 3, http.MethodPatch, "/centers/42/manage/students/11/series/100/razbor-access", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_SetStudentSeriesRazborAccessRejectsForeignSeries(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM math_center_students\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(manageStudentColumns).
			AddRow(int64(11), int64(55), int64(1), now, true))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(manageGroupColumns).
			AddRow(int64(1), int64(42), "А", now))
	mock.ExpectExec(`INSERT INTO math_center_student_series_razbor_access`).
		WithArgs(int64(11), int64(999), false, false).
		WillReturnResult(pgxmock.NewResult("INSERT", 0))

	body := strings.NewReader(`{"can_view_video":false,"can_view_pdf_tex":false}`)
	req := authedRequest(t, access, 3, http.MethodPatch, "/centers/42/manage/students/11/series/999/razbor-access", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_UserSearch(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM users\s+WHERE username ILIKE`).
		WithArgs("an").
		WillReturnRows(mock.NewRows([]string{"id", "username", "first_name", "middle_name", "last_name"}).
			AddRow(int64(55), "anya", "Аня", (*string)(nil), "Иванова"))

	req := authedRequest(t, access, 3, http.MethodGet, "/centers/42/manage/user-search?q=an", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_UserSearchShortQuery(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectHeadCheck(mock, 3, 42, true)
	// q too short → empty result, no SearchUsers query issued.

	req := authedRequest(t, access, 3, http.MethodGet, "/centers/42/manage/user-search?q=a", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if strings.TrimSpace(rr.Body.String()) != "[]" {
		t.Errorf("short query body: got %s, want []", rr.Body.String())
	}
}

func TestManage_CreateTeacherInvite(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	// Validate the teacher preset → the center must exist.
	mock.ExpectQuery(`FROM math_centers\s+WHERE id = \$1`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(manageCenterColumns).AddRow(int64(42), int32(2030), now))
	// The stored preset binds the token to THIS center; math_center_id is stamped.
	wantPreset := json.RawMessage(`{"version":1,"mathcenter_teacher":{"center_id":42,"is_head_teacher":true}}`)
	mock.ExpectQuery(`INSERT INTO invitation_tokens`).
		WithArgs(pgxmock.AnyArg(), "Teacher invite", int32(5), pgxmock.AnyArg(), wantPreset, ptrInt64(42)).
		WillReturnRows(mock.NewRows(manageTokenColumns).
			AddRow(int64(20), "tok-abc", "Teacher invite", int32(5), now.Add(72*time.Hour), now, wantPreset, ptrInt64(42)))

	body := strings.NewReader(`{"role":"teacher","is_head_teacher":true,"description":"Teacher invite","max_uses":5,"expires_in_hours":72}`)
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/manage/invites", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Role   string `json:"role"`
		Token  string `json:"token"`
		IsHead bool   `json:"is_head_teacher"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Role != "teacher" || resp.Token != "tok-abc" || !resp.IsHead {
		t.Errorf("invite view: %+v", resp)
	}
}

func TestManage_CreateInviteBadRole(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectHeadCheck(mock, 3, 42, true)

	body := strings.NewReader(`{"role":"admin","description":"x","max_uses":1,"expires_in_hours":1}`)
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/manage/invites", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestManage_RevokeInviteForeignCenter(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	// Token belongs to another center → not found.
	mock.ExpectQuery(`FROM invitation_tokens\s+WHERE id = \$1`).
		WithArgs(int64(20)).
		WillReturnRows(mock.NewRows(manageTokenColumns).
			AddRow(int64(20), "tok", "d", int32(5), now.Add(time.Hour), now, []byte(`{}`), ptrInt64(99)))

	req := authedRequest(t, access, 3, http.MethodDelete, "/centers/42/manage/invites/20", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

// ptrInt64 returns a pointer to v, for nullable *int64 mock args/rows.
func ptrInt64(v int64) *int64 { return &v }
