package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// userColumns matches the column order of `SELECT * FROM users` after sqlc
// generation. Keep aligned with the migration / store/users.sql.go.
var userColumns = []string{
	"id", "username", "password_hash", "first_name", "middle_name", "last_name",
	"invitation_token_id", "created_at", "updated_at",
}

var refreshTokenCols = []string{
	"id", "user_id", "token_hash", "expires_at", "revoked_at", "replaced_by_id", "created_at",
}

// newTokens builds a TokenService backed by the given mock pool. Access TTL
// is 1h so it doesn't expire mid-test.
func newTokens(t *testing.T, database *db.DB) *internalAuth.TokenService {
	t.Helper()
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
		Expiration: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("refresh service: %v", err)
	}
	ts, err := internalAuth.NewTokenService(internalAuth.TokenServiceConfig{
		Access:  access,
		Refresh: refresh,
	})
	if err != nil {
		t.Fatalf("token service: %v", err)
	}
	return ts
}

// expectRefreshInsert sets up the pgxmock expectation for the refresh-token
// INSERT that fires whenever IssuePair is called.
func expectRefreshInsert(t *testing.T, mock pgxmock.PgxPoolIface, userID int64) {
	t.Helper()
	now := time.Now()
	mock.ExpectQuery(`INSERT INTO refresh_tokens`).
		WithArgs(userID, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols).
			AddRow(int64(1), userID, []byte("hash"), now.Add(24*time.Hour), (*time.Time)(nil), (*int64)(nil), now))
}

// fastHash hashes a password with cheap argon2id parameters so the test
// suite stays fast. Production uses HashPassword (DefaultArgon2idParams).
func fastHash(t *testing.T, pw string) string {
	t.Helper()
	h, err := internalAuth.HashPasswordWith(pw, internalAuth.Argon2idParams{
		Memory: 8, Iterations: 1, Parallelism: 1, SaltLength: 8, KeyLength: 16,
	})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestLogin_Success(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM users WHERE username = \$1`).
		WithArgs("alice").
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(1), "alice", fastHash(t, "password123"), "Alice", (*string)(nil), "Doe", int64(1), now, now))
	expectRefreshInsert(t, mock, 1)

	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "password123"})
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var resp authHandlers.LoginResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.AccessToken == "" {
		t.Error("expected non-empty access_token")
	}
	if resp.RefreshToken == "" {
		t.Error("expected non-empty refresh_token")
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("token_type: got %q", resp.TokenType)
	}
	if resp.ExpiresIn != 3600 {
		t.Errorf("expires_in: got %d, want 3600", resp.ExpiresIn)
	}
	if resp.User.Username != "alice" {
		t.Errorf("user.username: got %q", resp.User.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestLogin_PasswordHashIsNotInResponse(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM users WHERE username = \$1`).
		WithArgs("alice").
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(1), "alice", fastHash(t, "password123"), "Alice", (*string)(nil), "Doe", int64(1), now, now))
	expectRefreshInsert(t, mock, 1)

	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "password123"})
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	// The User struct contains password_hash but is tagged json:"-" via
	// sqlc.yaml — it must never appear on the wire.
	if bytes.Contains(rr.Body.Bytes(), []byte("password_hash")) {
		t.Errorf("login response leaks password_hash:\n%s", rr.Body.String())
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM users WHERE username = \$1`).
		WithArgs("alice").
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(1), "alice", fastHash(t, "rightpassword"), "Alice", (*string)(nil), "Doe", int64(1), now, now))

	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "wrongpassword"})
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "invalid_credentials")
}

func TestLogin_UserNotFound(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectQuery(`SELECT .* FROM users WHERE username = \$1`).
		WithArgs("nobody").
		WillReturnRows(mock.NewRows(userColumns))

	body, _ := json.Marshal(map[string]string{"username": "nobody", "password": "anypassword"})
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "invalid_credentials")
}

func TestLogin_BadJSON(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewBufferString(`not-json`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "bad_request")
}

func TestLogin_ValidationFailure(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	body, _ := json.Marshal(map[string]string{"username": "ab", "password": ""})
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Login(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "validation_failed")
}
