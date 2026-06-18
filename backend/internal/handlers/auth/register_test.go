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

var invitationTokenColumns = []string{"id", "token", "description", "max_uses", "expires_at", "created_at"}

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
			AddRow(int64(1), "invite-abc", "test invite", int32(5), now.Add(24*time.Hour), now))
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
			AddRow(int64(1), "invite-abc", "test invite", int32(5), now.Add(24*time.Hour), now))
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
			AddRow(int64(1), "invite-abc", "d", int32(5), expired, expired.Add(-time.Hour)))
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
			AddRow(int64(1), "invite-abc", "d", int32(1), now.Add(time.Hour), now))
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
			AddRow(int64(1), "invite-abc", "d", int32(5), now.Add(time.Hour), now))
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
