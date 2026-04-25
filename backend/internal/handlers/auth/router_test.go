package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/ratelimit"
)

func TestRouter_MeRequiresAuth(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	database := db.NewDBWithPool(mock)
	r := authHandlers.Router(database, newTokens(t, database), ratelimit.NewMemory())

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated /me: got %d, want 401", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "unauthenticated")
}

func TestRouter_PublicEndpointsDoNotRequireAuth(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	database := db.NewDBWithPool(mock)
	r := authHandlers.Router(database, newTokens(t, database), ratelimit.NewMemory())

	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code == http.StatusUnauthorized {
		t.Errorf("public /login should not require auth; got 401")
	}
}
