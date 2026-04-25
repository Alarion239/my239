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

func TestLogout_Success(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens WHERE token_hash = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	mock.ExpectExec(`UPDATE refresh_tokens\s+SET revoked_at = NOW\(\)\s+WHERE id = \$1`).
		WithArgs(int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	body, _ := json.Marshal(map[string]string{"refresh_token": "raw"})
	req := httptest.NewRequest(http.MethodPost, "/logout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Logout(newTokens(t, database))(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("status: got %d, want 204", rr.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestLogout_UnknownTokenIsNoOp(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenCols))

	body, _ := json.Marshal(map[string]string{"refresh_token": "ghost"})
	req := httptest.NewRequest(http.MethodPost, "/logout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Logout(newTokens(t, database))(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("status: got %d, want 204", rr.Code)
	}
}

func TestLogout_ValidationFailure(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	body, _ := json.Marshal(map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/logout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	database := db.NewDBWithPool(mock)
	authHandlers.Logout(newTokens(t, database))(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "validation_failed")
}
