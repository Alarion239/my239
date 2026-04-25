package ctxcache_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func TestUser_ReturnsCachedUser(t *testing.T) {
	want := &store.User{ID: 1, Username: "alice"}
	ctx := context.WithValue(context.Background(), config.CtxKeyUser, want)

	got, ok := ctxcache.User(ctx)
	if !ok || got != want {
		t.Errorf("got (%v,%v), want (%v,true)", got, ok, want)
	}
}

func TestUser_NoCacheReturnsFalse(t *testing.T) {
	_, ok := ctxcache.User(context.Background())
	if ok {
		t.Error("expected ok=false on empty context")
	}
}

func TestUserID_NoIDReturnsError(t *testing.T) {
	_, err := ctxcache.UserID(context.Background())
	if !errors.Is(err, ctxcache.ErrNoUserIDFound) {
		t.Errorf("expected ErrNoUserIDFound, got %v", err)
	}
}

func TestUserID_Success(t *testing.T) {
	ctx := context.WithValue(context.Background(), config.CtxKeyUserID, int64(42))
	id, err := ctxcache.UserID(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 42 {
		t.Errorf("id: got %d, want 42", id)
	}
}

func TestEnsureUser_CacheHit(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	database := db.NewDBWithPool(mock)
	want := &store.User{ID: 5, Username: "cached"}
	ctx := context.WithValue(context.Background(), config.CtxKeyUser, want)

	_, got, err := ctxcache.EnsureUser(database, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != want {
		t.Errorf("got %v, want %v", got, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("no DB queries should have run: %v", err)
	}
}

func TestEnsureUser_NoID(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	database := db.NewDBWithPool(mock)

	_, _, err = ctxcache.EnsureUser(database, context.Background())
	if !errors.Is(err, ctxcache.ErrNoUserIDFound) {
		t.Errorf("expected ErrNoUserIDFound, got %v", err)
	}
}

func TestEnsureUser_CacheMissFetchesAndCaches(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	now := time.Now()
	rows := mock.NewRows([]string{
		"id", "username", "password_hash", "first_name", "middle_name", "last_name",
		"invitation_token_id", "created_at", "updated_at", "is_admin",
	}).AddRow(int64(7), "bob", "argon2idhash", "Bob", (*string)(nil), "Smith", int64(1), now, now, false)
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnRows(rows)

	database := db.NewDBWithPool(mock)
	ctx := context.WithValue(context.Background(), config.CtxKeyUserID, int64(7))

	newCtx, got, err := ctxcache.EnsureUser(database, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil || got.ID != 7 || got.Username != "bob" {
		t.Fatalf("got %+v", got)
	}

	// Second call should hit cache (no new query expected).
	_, got2, err := ctxcache.EnsureUser(database, newCtx)
	if err != nil {
		t.Fatalf("unexpected error on cached call: %v", err)
	}
	if got2 != got {
		t.Error("cached user should be identical")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestEnsureUser_NotFoundReturnsRowsError(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(99)).
		WillReturnError(pgx.ErrNoRows)

	database := db.NewDBWithPool(mock)
	ctx := context.WithValue(context.Background(), config.CtxKeyUserID, int64(99))

	_, _, err = ctxcache.EnsureUser(database, ctx)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("expected pgx.ErrNoRows, got %v", err)
	}
}
