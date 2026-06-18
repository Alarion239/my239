package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
)

var invitationTokenColumns = []string{"id", "token", "description", "max_uses", "expires_at", "created_at", "preset"}

// emptyPreset is the JSONB stored by tokens with no enrollment intent.
var emptyPreset = []byte(`{}`)

func validRegisterBody() []byte {
	b, _ := json.Marshal(map[string]any{
		"username":         "newuser",
		"password":         "password123",
		"invitation_token": "invite-abc",
		"first_name":       "New",
		"middle_name":      nil,
		"last_name":        "User",
	})
	return b
}

func TestRegister_Success(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM invitation_tokens WHERE token = \$1 FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "test invite", int32(5), now.Add(24*time.Hour), now, emptyPreset))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM users WHERE invitation_token_id = \$1`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("newuser", pgxmock.AnyArg(), "New", (*string)(nil), "User", ptrInt64(1)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "newuser", "argon2idhash", "New", (*string)(nil), "User", ptrInt64(1), now, now, false, false))
	mock.ExpectCommit()
	expectRefreshInsert(t, mock, 42)

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var resp authHandlers.RegisterResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.AccessToken == "" || resp.RefreshToken == "" {
		t.Errorf("expected non-empty tokens, got %+v", resp)
	}
	if resp.User.Username != "newuser" {
		t.Errorf("user: got %+v", resp.User)
	}
	// password_hash must not leak.
	if bytes.Contains(rr.Body.Bytes(), []byte("password_hash")) {
		t.Error("register response leaks password_hash")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// TestRegister_UsernameLowercased verifies the handler normalizes a mixed-case
// username to lowercase before it reaches CreateUser, so the stored value and
// the users_username_lowercase CHECK constraint agree.
func TestRegister_UsernameLowercased(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "test invite", int32(5), now.Add(24*time.Hour), now, emptyPreset))
	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	// The mock only matches if CreateUser receives the lowercased username.
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("mixedcase", pgxmock.AnyArg(), "New", (*string)(nil), "User", ptrInt64(1)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "mixedcase", "argon2idhash", "New", (*string)(nil), "User", ptrInt64(1), now, now, false, false))
	mock.ExpectCommit()
	expectRefreshInsert(t, mock, 42)

	body, _ := json.Marshal(map[string]any{
		"username":         "MixedCase",
		"password":         "password123",
		"invitation_token": "invite-abc",
		"first_name":       "New",
		"middle_name":      nil,
		"last_name":        "User",
	})
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestRegister_TokenNotFound(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns))
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "token_invalid")
}

func TestRegister_TokenExpired(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	expired := time.Now().Add(-time.Hour)
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "d", int32(5), expired, expired.Add(-time.Hour), emptyPreset))
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "token_expired")
}

func TestRegister_TokenExhausted(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "d", int32(1), now.Add(time.Hour), now, emptyPreset))
	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "token_exhausted")
}

func TestRegister_UsernameTaken(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "d", int32(5), now.Add(time.Hour), now, emptyPreset))
	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("newuser", pgxmock.AnyArg(), "New", (*string)(nil), "User", ptrInt64(1)).
		WillReturnError(&pgconn.PgError{Code: "23505", Message: "duplicate"})
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf("status: got %d, want 409", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "conflict")
}

func TestRegister_ValidationFailure(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	bad, _ := json.Marshal(map[string]any{
		"username":         "ab",
		"password":         "short",
		"invitation_token": "t",
		"first_name":       "",
	})
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(bad))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "validation_failed")
}

// TestRegister_AdminPreset verifies a token whose preset grants admin causes
// SetUserAdmin to fire inside the registration transaction (after CreateUser,
// before commit) and that the response reflects the granted flag.
func TestRegister_AdminPreset(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "admin invite", int32(5), now.Add(24*time.Hour), now, []byte(`{"version":1,"grants_admin":true}`)))
	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("newuser", pgxmock.AnyArg(), "New", (*string)(nil), "User", ptrInt64(1)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "newuser", "argon2idhash", "New", (*string)(nil), "User", ptrInt64(1), now, now, false, false))
	// The admin grant must run inside the tx, before commit.
	mock.ExpectExec(`UPDATE users\s+SET is_admin`).
		WithArgs(int64(42), true).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	expectRefreshInsert(t, mock, 42)

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp authHandlers.RegisterResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.User.IsAdmin {
		t.Errorf("response user should reflect granted admin flag: %+v", resp.User)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// TestRegister_StudentPreset verifies a student-enrollment preset drives
// GetGroup → IsTeacherInCenter (exclusivity guard) → AddStudentToGroup inside
// the registration transaction, in that order.
func TestRegister_StudentPreset(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`FOR UPDATE`).
		WithArgs("invite-abc").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "invite-abc", "student invite", int32(5), now.Add(24*time.Hour), now, []byte(`{"version":1,"mathcenter_student":{"group_id":3}}`)))
	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("newuser", pgxmock.AnyArg(), "New", (*string)(nil), "User", ptrInt64(1)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "newuser", "argon2idhash", "New", (*string)(nil), "User", ptrInt64(1), now, now, false, false))
	// Resolve the group's center.
	mock.ExpectQuery(`SELECT .* FROM math_center_groups WHERE id = \$1`).
		WithArgs(int64(3)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "name", "created_at"}).
			AddRow(int64(3), int64(7), "Group A", now))
	// Exclusivity guard: not already a teacher of center 7.
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(int64(42), int64(7)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`INSERT INTO math_center_students`).
		WithArgs(int64(42), int64(3)).
		WillReturnRows(mock.NewRows([]string{"id", "user_id", "group_id", "created_at"}).
			AddRow(int64(1), int64(42), int64(3), now))
	mock.ExpectCommit()
	expectRefreshInsert(t, mock, 42)

	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(validRegisterBody()))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewWithPool(mock)
	authHandlers.Register(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
