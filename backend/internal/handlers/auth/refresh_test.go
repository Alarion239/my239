package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func TestRefresh_Success(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens WHERE token_hash = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	mock.ExpectQuery(`INSERT INTO refresh_tokens`).
		WithArgs(int64(7), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols).
			AddRow(int64(2), int64(7), []byte("hash2"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	newID := int64(2)
	mock.ExpectExec(`UPDATE refresh_tokens\s+SET revoked_at = NOW\(\), replaced_by_id = \$2`).
		WithArgs(int64(1), &newID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(7), "alice", "argon2idhash", "Alice", (*string)(nil), "Doe", ptrInt64(1), now, now, false, false))

	body, _ := json.Marshal(map[string]string{"refresh_token": "old-raw"})
	req := httptest.NewRequest(http.MethodPost, "/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Refresh(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var resp authHandlers.RefreshResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.AccessToken == "" || resp.RefreshToken == "" {
		t.Errorf("expected non-empty tokens: %+v", resp)
	}
	if resp.TokenType != "Bearer" {
		t.Errorf("token_type: got %q", resp.TokenType)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestRefresh_TokenInvalid(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols))
	mock.ExpectRollback()

	body, _ := json.Marshal(map[string]string{"refresh_token": "missing"})
	req := httptest.NewRequest(http.MethodPost, "/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Refresh(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "token_invalid")
}

func TestRefresh_TokenExpired(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(-time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	mock.ExpectRollback()

	body, _ := json.Marshal(map[string]string{"refresh_token": "expired"})
	req := httptest.NewRequest(http.MethodPost, "/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Refresh(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "token_expired")
}

func TestRefresh_ValidationFailure(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	body, _ := json.Marshal(map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Refresh(database, newTokens(t, database))(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "validation_failed")
}
