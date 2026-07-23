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
	manageStudentColumns = []string{"id", "user_id", "group_id", "created_at"}
	manageCenterColumns  = []string{"id", "graduation_year", "created_at"}
	manageTokenColumns   = []string{
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

func TestManage_CreateGroup(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectHeadCheck(mock, 3, 42, true)
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(42), "Б").
		WillReturnRows(mock.NewRows(manageGroupColumns).AddRow(int64(7), int64(42), "Б", now))

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
		WillReturnRows(mock.NewRows(manageStudentColumns).AddRow(int64(11), int64(55), int64(1), now))
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
