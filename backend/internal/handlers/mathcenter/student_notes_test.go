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

var studentNoteColumns = []string{
	"id", "student_user_id", "math_center_id", "author_user_id", "body",
	"created_at", "updated_at",
}

var studentNoteAuthoredColumns = []string{
	"id", "student_user_id", "math_center_id", "author_user_id",
	"author_first_name", "author_last_name", "body", "created_at", "updated_at",
}

var userColumns = []string{
	"id", "username", "password_hash", "first_name", "middle_name", "last_name",
	"invitation_token_id", "created_at", "updated_at", "is_admin", "is_math_center",
}

var studentByUserColumns = []string{
	"id", "user_id", "group_id", "group_name", "math_center_id", "graduation_year",
}

func expectTeacherInCenter(mock pgxmock.PgxPoolIface, userID, centerID int64, ok bool) {
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(ok))
}

func expectStudentInCenter(mock pgxmock.PgxPoolIface, userID, centerID int64, ok bool) {
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(ok))
}

func TestCreateStudentNote_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	mock.ExpectQuery(`INSERT INTO math_center_student_note`).
		WithArgs(int64(99), int64(42), int64(3), "consistently strong on geometry").
		WillReturnRows(mock.NewRows(studentNoteColumns).
			AddRow(int64(700), int64(99), int64(42), int64(3), "consistently strong on geometry", now, now))
	mock.ExpectQuery(`FROM math_center_student_note n\s+JOIN users u .* WHERE n.id`).
		WithArgs(int64(700)).
		WillReturnRows(mock.NewRows(studentNoteAuthoredColumns).
			AddRow(int64(700), int64(99), int64(42), int64(3), "Пётр", "Учитель", "consistently strong on geometry", now, now))

	body, _ := json.Marshal(map[string]any{"body": "consistently strong on geometry"})
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/students/99/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["author_name"] != "Пётр Учитель" {
		t.Errorf("author_name: got %v", got["author_name"])
	}
}

func TestCreateStudentNote_RejectsNonStudentTarget(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, false)

	body, _ := json.Marshal(map[string]any{"body": "note"})
	req := authedRequest(t, access, 3, http.MethodPost, "/centers/42/students/99/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestCreateStudentNote_RejectsNonTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 9, 42, false)

	body, _ := json.Marshal(map[string]any{"body": "note"})
	req := authedRequest(t, access, 9, http.MethodPost, "/centers/42/students/99/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetStudentProfile_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	mock.ExpectQuery(`FROM math_center_students s\s+JOIN math_center_groups`).
		WithArgs(int64(99)).
		WillReturnRows(mock.NewRows(studentByUserColumns).
			AddRow(int64(1), int64(99), int64(5), "Группа А", int64(42), int32(2026)))
	mock.ExpectQuery(`SELECT .* FROM users\s+WHERE id`).
		WithArgs(int64(99)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(99), "ivanov", "x", "Иван", (*string)(nil), "Иванов", (*int64)(nil), now, now, false, false))

	req := authedRequest(t, access, 3, http.MethodGet, "/centers/42/students/99/", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["display_name"] != "Иван Иванов" {
		t.Errorf("display_name: got %v", got["display_name"])
	}
	if got["group_name"] != "Группа А" {
		t.Errorf("group_name: got %v", got["group_name"])
	}
}

func TestUpdateStudentNote_RejectsNonAuthor(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	// Note authored by user 4; user 3 (a teacher, not the author) tries to edit.
	mock.ExpectQuery(`SELECT .* FROM math_center_student_note\s+WHERE id`).
		WithArgs(int64(700)).
		WillReturnRows(mock.NewRows(studentNoteColumns).
			AddRow(int64(700), int64(99), int64(42), int64(4), "original", now, now))

	body, _ := json.Marshal(map[string]any{"body": "rewrite"})
	req := authedRequest(t, access, 3, http.MethodPatch, "/centers/42/students/99/notes/700", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}
