package admin_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/store"
)

func TestGetUser_Found(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM users\s+WHERE id = \$1`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(11), "alice", "argon2idhash", "Alice", (*string)(nil), "Smith", (*int64)(nil), now, now, false, false))

	req := adminRequest(t, access, true, http.MethodGet, "/users/11", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200, body=%s", rr.Code, rr.Body.String())
	}

	var user store.User
	if err := json.Unmarshal(rr.Body.Bytes(), &user); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if user.ID != 11 || user.Username != "alice" {
		t.Errorf("user: got id=%d username=%q", user.ID, user.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestGetUser_Missing(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	mock.ExpectQuery(`SELECT .* FROM users\s+WHERE id = \$1`).
		WithArgs(int64(404)).
		WillReturnError(pgx.ErrNoRows)

	req := adminRequest(t, access, true, http.MethodGet, "/users/404", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404, body=%s", rr.Code, rr.Body.String())
	}
	assertCode(t, rr.Body.Bytes(), "not_found")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// teacherEnrollmentColumns matches ListTeacherEnrollmentsForUser's projection.
var teacherEnrollmentColumns = []string{"teacher_id", "center_id", "graduation_year", "is_head_teacher"}

// studentEnrollmentColumns matches GetStudentByUserID's projection.
var studentEnrollmentColumns = []string{"id", "user_id", "group_id", "group_name", "math_center_id", "graduation_year"}

// enrollmentsResponse mirrors the handler's JSON shape for assertions.
type enrollmentsResponse struct {
	Teaching []struct {
		TeacherID      int64 `json:"teacher_id"`
		CenterID       int64 `json:"center_id"`
		GraduationYear int   `json:"graduation_year"`
		Grade          int   `json:"grade"`
		IsHeadTeacher  bool  `json:"is_head_teacher"`
	} `json:"teaching"`
	Student *struct {
		StudentID      int64  `json:"student_id"`
		CenterID       int64  `json:"center_id"`
		GroupID        int64  `json:"group_id"`
		GroupName      string `json:"group_name"`
		GraduationYear int    `json:"graduation_year"`
		Grade          int    `json:"grade"`
	} `json:"student"`
}

func TestGetUserEnrollments_TeachingAndStudent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	// Teaches two centers, with the row ids the UI needs to remove them.
	mock.ExpectQuery(`SELECT .* FROM math_center_teachers t`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(teacherEnrollmentColumns).
			AddRow(int64(101), int64(9), int32(2030), true).
			AddRow(int64(102), int64(8), int32(2031), false))
	// Studies at one center.
	mock.ExpectQuery(`SELECT .* FROM math_center_students s`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(studentEnrollmentColumns).
			AddRow(int64(55), int64(11), int64(4), "Group A", int64(7), int32(2032)))

	req := adminRequest(t, access, true, http.MethodGet, "/users/11/enrollments", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200, body=%s", rr.Code, rr.Body.String())
	}

	var resp enrollmentsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Teaching) != 2 {
		t.Fatalf("teaching: got %d entries, want 2", len(resp.Teaching))
	}
	if resp.Teaching[0].TeacherID != 101 || resp.Teaching[0].CenterID != 9 || !resp.Teaching[0].IsHeadTeacher {
		t.Errorf("teaching[0]: got %+v", resp.Teaching[0])
	}
	if resp.Teaching[1].TeacherID != 102 || resp.Teaching[1].CenterID != 8 || resp.Teaching[1].IsHeadTeacher {
		t.Errorf("teaching[1]: got %+v", resp.Teaching[1])
	}
	if resp.Student == nil {
		t.Fatal("student: got nil, want enrollment")
	}
	if resp.Student.StudentID != 55 || resp.Student.GroupID != 4 || resp.Student.GroupName != "Group A" || resp.Student.CenterID != 7 {
		t.Errorf("student: got %+v", resp.Student)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestGetUserEnrollments_None(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	mock.ExpectQuery(`SELECT .* FROM math_center_teachers t`).
		WithArgs(int64(11)).
		WillReturnRows(mock.NewRows(teacherEnrollmentColumns))
	mock.ExpectQuery(`SELECT .* FROM math_center_students s`).
		WithArgs(int64(11)).
		WillReturnError(pgx.ErrNoRows)

	req := adminRequest(t, access, true, http.MethodGet, "/users/11/enrollments", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200, body=%s", rr.Code, rr.Body.String())
	}

	var resp enrollmentsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Teaching) != 0 {
		t.Errorf("teaching: got %d entries, want 0", len(resp.Teaching))
	}
	if resp.Student != nil {
		t.Errorf("student: got %+v, want null", resp.Student)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}
