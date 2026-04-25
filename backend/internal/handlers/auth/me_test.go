package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/config"
	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func TestMe_Unauthenticated(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	rr := httptest.NewRecorder()

	authHandlers.Me(db.NewDBWithPool(mock))(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d, want 401", rr.Code)
	}
}

func TestMe_CacheHit(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	want := &store.User{ID: 1, Username: "alice", FirstName: "Alice", LastName: "Doe"}
	ctx := context.WithValue(context.Background(), config.CtxKeyUser, want)

	req := httptest.NewRequest(http.MethodGet, "/me", nil).WithContext(ctx)
	rr := httptest.NewRecorder()

	authHandlers.Me(db.NewDBWithPool(mock))(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var got store.User
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Username != "alice" {
		t.Errorf("username: got %q", got.Username)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("should not hit DB on cache hit: %v", err)
	}
}

func TestMe_CacheMissFetchesUser(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(42), "alice", "argon2idhash", "Alice", (*string)(nil), "Doe", int64(1), now, now))

	ctx := context.WithValue(context.Background(), config.CtxKeyUserID, int64(42))
	req := httptest.NewRequest(http.MethodGet, "/me", nil).WithContext(ctx)
	rr := httptest.NewRecorder()

	authHandlers.Me(db.NewDBWithPool(mock))(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var got store.User
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != 42 || got.Username != "alice" {
		t.Errorf("got %+v", got)
	}
	// password_hash must not leak.
	if bytes := rr.Body.Bytes(); contains(bytes, "password_hash") {
		t.Errorf("/me response leaks password_hash: %s", bytes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func contains(haystack []byte, needle string) bool {
	n := []byte(needle)
	for i := 0; i+len(n) <= len(haystack); i++ {
		if string(haystack[i:i+len(n)]) == needle {
			return true
		}
	}
	return false
}
