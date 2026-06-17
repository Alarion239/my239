package admin_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/handlers/admin"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// userColumns matches the column order of `SELECT * FROM users` after sqlc;
// keep aligned with store/models.go and the migrations.
var userColumns = []string{
	"id", "username", "password_hash", "first_name", "middle_name", "last_name",
	"invitation_token_id", "created_at", "updated_at", "is_admin", "is_math_center",
}

// teacherColumns matches `SELECT * FROM math_center_teachers`.
var teacherColumns = []string{"id", "user_id", "math_center_id", "is_head_teacher", "created_at"}

// studentColumns matches AddStudentToGroup's RETURNING list.
var studentColumns = []string{"id", "user_id", "group_id", "created_at"}

// groupColumns matches `SELECT * FROM math_center_groups` (GetGroup).
var groupColumns = []string{"id", "math_center_id", "name", "created_at"}

// newAdminRouter wires the admin router around a mock pool, returning the
// handler plus the access service used to mint tokens (so the AuthMiddleware
// in the router and the test agree on the signing key).
func newAdminRouter(t *testing.T, mock pgxmock.PgxPoolIface) (http.Handler, *internalAuth.AccessTokenService) {
	t.Helper()
	database := db.NewWithPool(mock)
	access, err := internalAuth.NewAccessTokenService(internalAuth.AccessTokenConfig{
		Secret:     "test-secret",
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("access service: %v", err)
	}
	refresh, err := internalAuth.NewRefreshTokenService(internalAuth.RefreshTokenConfig{
		DB:         database,
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("refresh service: %v", err)
	}
	tokens, err := internalAuth.NewTokenService(internalAuth.TokenServiceConfig{
		Access: access, Refresh: refresh,
	})
	if err != nil {
		t.Fatalf("token service: %v", err)
	}
	return admin.Router(database, tokens), access
}

// adminRequest builds a request carrying an access token for the given user
// with the supplied admin flag, so the router's Auth+Admin middleware accept
// (or reject) it as intended.
func adminRequest(t *testing.T, access *internalAuth.AccessTokenService, isAdmin bool, method, path string, body io.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	tok, err := access.Generate(7, "admin", isAdmin)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func accountBody(t *testing.T, m map[string]any) []byte {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	return b
}

func TestCreateMathCenterAccount_Success(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	mock.ExpectBegin()
	// The shared account is inserted with no invitation lineage and the
	// is_math_center flag set TRUE by the query itself.
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("mc-room-1", pgxmock.AnyArg(), "Room", (*string)(nil), "101").
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "mc-room-1", "argon2idhash", "Room", (*string)(nil), "101", (*int64)(nil), now, now, false, true))
	// Enrolled as a head teacher of the center named in the path.
	mock.ExpectQuery(`INSERT INTO math_center_teachers`).
		WithArgs(int64(42), int64(9), true).
		WillReturnRows(mock.NewRows(teacherColumns).
			AddRow(int64(5), int64(42), int64(9), true, now))
	mock.ExpectCommit()

	body := accountBody(t, map[string]any{
		"username": "mc-room-1", "password": "classpass1", "first_name": "Room", "last_name": "101",
	})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/9/accounts", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var user store.User
	if err := json.Unmarshal(rr.Body.Bytes(), &user); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if user.Username != "mc-room-1" {
		t.Errorf("username: got %q", user.Username)
	}
	if !user.IsMathCenter {
		t.Error("expected is_math_center=true on the created account")
	}
	if user.IsAdmin {
		t.Error("MathCenter account must not be a platform admin")
	}
	// password_hash must never leak onto the wire (json:"-").
	if bytes.Contains(rr.Body.Bytes(), []byte("password_hash")) {
		t.Errorf("response leaks password_hash:\n%s", rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestCreateMathCenterAccount_UsernameTaken(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(&pgconn.PgError{Code: "23505"}) // unique_violation
	mock.ExpectRollback()

	body := accountBody(t, map[string]any{
		"username": "taken-name", "password": "classpass1", "first_name": "Room",
	})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/9/accounts", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409, body=%s", rr.Code, rr.Body.String())
	}
	assertCode(t, rr.Body.Bytes(), "conflict")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestCreateMathCenterAccount_CenterMissing(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "mc-room-1", "argon2idhash", "Room", (*string)(nil), "", (*int64)(nil), now, now, false, true))
	// The center FK fails -> whole transaction rolls back, account never lands.
	mock.ExpectQuery(`INSERT INTO math_center_teachers`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(&pgconn.PgError{Code: "23503"}) // foreign_key_violation
	mock.ExpectRollback()

	body := accountBody(t, map[string]any{
		"username": "mc-room-1", "password": "classpass1", "first_name": "Room",
	})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/999/accounts", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
	assertCode(t, rr.Body.Bytes(), "bad_request")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestCreateMathCenterAccount_Validation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body map[string]any
	}{
		{"username too short", map[string]any{"username": "mc", "password": "classpass1", "first_name": "Room"}},
		{"password too short", map[string]any{"username": "mc-room-1", "password": "short", "first_name": "Room"}},
		{"missing first_name", map[string]any{"username": "mc-room-1", "password": "classpass1"}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			mock, _ := pgxmock.NewPool()
			defer mock.Close()
			r, access := newAdminRouter(t, mock)

			// No DB expectations: validation rejects before any query runs.
			req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/9/accounts", bytes.NewReader(accountBody(t, c.body)))
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status: got %d, want 400, body=%s", rr.Code, rr.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unexpected DB activity: %v", err)
			}
		})
	}
}

func TestCreateMathCenterAccount_RequiresAdmin(t *testing.T) {
	t.Parallel()

	body := accountBody(t, map[string]any{
		"username": "mc-room-1", "password": "classpass1", "first_name": "Room",
	})

	t.Run("non-admin is forbidden", func(t *testing.T) {
		t.Parallel()
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		r, access := newAdminRouter(t, mock)

		req := adminRequest(t, access, false, http.MethodPost, "/mathcenter/9/accounts", bytes.NewReader(body))
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Fatalf("status: got %d, want 403, body=%s", rr.Code, rr.Body.String())
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unexpected DB activity: %v", err)
		}
	})

	t.Run("unauthenticated is rejected", func(t *testing.T) {
		t.Parallel()
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		r, _ := newAdminRouter(t, mock)

		req := httptest.NewRequest(http.MethodPost, "/mathcenter/9/accounts", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status: got %d, want 401, body=%s", rr.Code, rr.Body.String())
		}
	})
}

// --- Per-center role exclusivity --------------------------------------------

func TestAddTeacher_RejectsStudentOfSameCenter(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	// The user is already a student of center 9 -> teaching it is forbidden.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(9)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(true))
	mock.ExpectRollback()

	body := accountBody(t, map[string]any{"user_id": 7})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/9/teachers", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409, body=%s", rr.Code, rr.Body.String())
	}
	assertCode(t, rr.Body.Bytes(), "conflict")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestAddTeacher_AllowsTeacherOfDifferentCenterThanStudied(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	// Studying elsewhere (not center 9) -> not a student of 9 -> allowed.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(9)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))
	mock.ExpectQuery(`INSERT INTO math_center_teachers`).
		WithArgs(int64(7), int64(9), false).
		WillReturnRows(mock.NewRows(teacherColumns).
			AddRow(int64(3), int64(7), int64(9), false, now))
	mock.ExpectCommit()

	body := accountBody(t, map[string]any{"user_id": 7})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/9/teachers", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, want 201, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestAddStudent_RejectsTeacherOfSameCenter(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	// Group 4 belongs to center 9; the user already teaches center 9.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, math_center_id, name, created_at\s+FROM math_center_groups`).
		WithArgs(int64(4)).
		WillReturnRows(mock.NewRows(groupColumns).AddRow(int64(4), int64(9), "A", now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(9)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectRollback()

	body := accountBody(t, map[string]any{"user_id": 7, "group_id": 4})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/students", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status: got %d, want 409, body=%s", rr.Code, rr.Body.String())
	}
	assertCode(t, rr.Body.Bytes(), "conflict")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestAddStudent_AllowsStudentOfDifferentCenterThanTaught(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access := newAdminRouter(t, mock)

	now := time.Now()
	// Group 4 -> center 9; the user does not teach center 9 (teaches A elsewhere).
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, math_center_id, name, created_at\s+FROM math_center_groups`).
		WithArgs(int64(4)).
		WillReturnRows(mock.NewRows(groupColumns).AddRow(int64(4), int64(9), "A", now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(9)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`INSERT INTO math_center_students`).
		WithArgs(int64(7), int64(4)).
		WillReturnRows(mock.NewRows(studentColumns).AddRow(int64(8), int64(7), int64(4), now))
	mock.ExpectCommit()

	body := accountBody(t, map[string]any{"user_id": 7, "group_id": 4})
	req := adminRequest(t, access, true, http.MethodPost, "/mathcenter/students", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, want 201, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// assertCode unmarshals an error envelope and checks its `code` field.
func assertCode(t *testing.T, body []byte, want string) {
	t.Helper()
	var env struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode error envelope: %v (body=%s)", err, body)
	}
	if env.Code != want {
		t.Errorf("error code: got %q, want %q (body=%s)", env.Code, want, string(body))
	}
}
