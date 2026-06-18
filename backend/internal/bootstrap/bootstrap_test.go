package bootstrap_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/bootstrap"
	"github.com/Alarion239/my239/backend/internal/store"
)

// invitationTokenColumns matches `SELECT * FROM invitation_tokens` after sqlc.
var invitationTokenColumns = []string{"id", "token", "description", "max_uses", "expires_at", "created_at", "preset"}

// TestEnsureAdminInviteToken_NoUsersCreatesToken verifies that an empty
// deployment with no existing bootstrap token mints a fresh single-use one.
func TestEnsureAdminInviteToken_NoUsersCreatesToken(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT count\(\*\) FROM users`).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	// No active bootstrap token exists yet.
	mock.ExpectQuery(`SELECT .* FROM invitation_tokens`).
		WillReturnRows(mock.NewRows(invitationTokenColumns))
	// A new single-use bootstrap token is created.
	mock.ExpectQuery(`INSERT INTO invitation_tokens`).
		WithArgs(pgxmock.AnyArg(), "first-admin bootstrap", int32(1), pgxmock.AnyArg(), json.RawMessage(`{}`)).
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "deadbeef", "first-admin bootstrap", int32(1), now.Add(7*24*time.Hour), now, []byte(`{}`)))

	if err := bootstrap.EnsureAdminInviteToken(context.Background(), store.New(mock)); err != nil {
		t.Fatalf("EnsureAdminInviteToken: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestEnsureAdminInviteToken_UsersExistNoOp verifies that when users already
// exist no token is listed or created.
func TestEnsureAdminInviteToken_UsersExistNoOp(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT count\(\*\) FROM users`).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(3)))
	// No further queries are expected.

	if err := bootstrap.EnsureAdminInviteToken(context.Background(), store.New(mock)); err != nil {
		t.Fatalf("EnsureAdminInviteToken: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestEnsureAdminInviteToken_ReusesActiveToken verifies that an existing
// active "first-admin bootstrap" token is reused rather than minting a new one.
func TestEnsureAdminInviteToken_ReusesActiveToken(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT count\(\*\) FROM users`).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	// An unexpired bootstrap token already exists.
	mock.ExpectQuery(`SELECT .* FROM invitation_tokens`).
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "existing-token", "first-admin bootstrap", int32(1), now.Add(time.Hour), now, []byte(`{}`)))
	// It is unused (0 < max_uses), so it gets reused.
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM users WHERE invitation_token_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(0)))
	// No INSERT expected: reusing means no CreateInvitationToken call.

	if err := bootstrap.EnsureAdminInviteToken(context.Background(), store.New(mock)); err != nil {
		t.Fatalf("EnsureAdminInviteToken: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}
