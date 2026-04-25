package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func newRefreshSvc(t *testing.T, database *db.DB) *internalAuth.RefreshTokenService {
	t.Helper()
	svc, err := internalAuth.NewRefreshTokenService(internalAuth.RefreshTokenConfig{
		DB:         database,
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewRefreshTokenService: %v", err)
	}
	return svc
}

// refreshTokenColumns matches the column order sqlc selects in
// refresh_tokens.sql for "SELECT *". Keep this in sync with the migration.
var refreshTokenColumns = []string{"id", "user_id", "token_hash", "expires_at", "revoked_at", "replaced_by_id", "created_at"}

func TestRefreshTokenService_BadConfig(t *testing.T) {
	if _, err := internalAuth.NewRefreshTokenService(internalAuth.RefreshTokenConfig{Expiration: time.Hour}); err == nil {
		t.Fatal("expected error when DB is nil")
	}
	if _, err := internalAuth.NewRefreshTokenService(internalAuth.RefreshTokenConfig{DB: db.NewDBWithPool(nil)}); err == nil {
		t.Fatal("expected error when expiration is zero")
	}
}

func TestRefreshTokenService_Issue(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`INSERT INTO refresh_tokens`).
		WithArgs(int64(7), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	raw, err := svc.Issue(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != 64 {
		t.Errorf("token length: got %d, want 64 (32 bytes hex)", len(raw))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestRefreshTokenService_Exchange_Success(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens WHERE token_hash = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	mock.ExpectQuery(`INSERT INTO refresh_tokens`).
		WithArgs(int64(7), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns).
			AddRow(int64(2), int64(7), []byte("hash2"), now.Add(time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	newID := int64(2)
	mock.ExpectExec(`UPDATE refresh_tokens\s+SET revoked_at = NOW\(\), replaced_by_id = \$2`).
		WithArgs(int64(1), &newID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	newRaw, userID, err := svc.Exchange(context.Background(), "old-raw")
	if err != nil {
		t.Fatal(err)
	}
	if userID != 7 {
		t.Errorf("userID: got %d, want 7", userID)
	}
	if len(newRaw) != 64 {
		t.Errorf("token length: got %d", len(newRaw))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestRefreshTokenService_Exchange_NotFound(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns))
	mock.ExpectRollback()

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	_, _, err := svc.Exchange(context.Background(), "nope")
	if !errors.Is(err, internalAuth.ErrRefreshTokenInvalid) {
		t.Errorf("err: got %v, want ErrRefreshTokenInvalid", err)
	}
}

func TestRefreshTokenService_Exchange_AlreadyRevoked(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	revokedAt := now.Add(-time.Minute)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(time.Hour), &revokedAt, (*int64)(nil), now))
	mock.ExpectRollback()

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	_, _, err := svc.Exchange(context.Background(), "raw")
	if !errors.Is(err, internalAuth.ErrRefreshTokenRevoked) {
		t.Errorf("err: got %v, want ErrRefreshTokenRevoked", err)
	}
}

func TestRefreshTokenService_Exchange_Expired(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns).
			AddRow(int64(1), int64(7), []byte("hash"), now.Add(-time.Hour), (*time.Time)(nil), (*int64)(nil), now))
	mock.ExpectRollback()

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	_, _, err := svc.Exchange(context.Background(), "raw")
	if !errors.Is(err, internalAuth.ErrRefreshTokenExpired) {
		t.Errorf("err: got %v, want ErrRefreshTokenExpired", err)
	}
}

func TestRefreshTokenService_Revoke_Idempotent(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectQuery(`SELECT .* FROM refresh_tokens`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(refreshTokenColumns))

	database := db.NewDBWithPool(mock)
	svc := newRefreshSvc(t, database)

	if err := svc.Revoke(context.Background(), "unknown"); err != nil {
		t.Errorf("revoking unknown token should be a no-op, got %v", err)
	}
}
