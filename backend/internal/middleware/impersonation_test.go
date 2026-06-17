package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// userColumns matches `SELECT * FROM users` (GetUserByID); keep aligned with
// store/models.go and the migrations.
var userColumns = []string{
	"id", "username", "password_hash", "first_name", "middle_name", "last_name",
	"invitation_token_id", "created_at", "updated_at", "is_admin", "is_math_center",
}

// withAuth builds a context carrying the identity AuthMiddleware would set.
func withAuth(realUserID int64, realIsAdmin bool) context.Context {
	ctx := context.WithValue(context.Background(), config.CtxKeyUserID, realUserID)
	return context.WithValue(ctx, config.CtxKeyIsAdmin, realIsAdmin)
}

// identityCapture is a terminal handler that records the EFFECTIVE identity
// the middleware leaves on the context, so a test can assert on the swap.
type identity struct {
	userID      int64
	isAdmin     bool
	realUserID  int64
	hasRealUser bool
}

func captureIdentity(out *identity) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out.userID, _ = r.Context().Value(config.CtxKeyUserID).(int64)
		out.isAdmin, _ = r.Context().Value(config.CtxKeyIsAdmin).(bool)
		out.realUserID, out.hasRealUser = r.Context().Value(config.CtxKeyRealUserID).(int64)
		w.WriteHeader(http.StatusOK)
	}
}

func TestImpersonation_AdminWithValidHeaderSwapsIdentity(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	database := db.NewWithPool(mock)

	now := time.Now()
	// Target user 55 is a non-admin; the admin impersonates them.
	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(55)).
		WillReturnRows(mock.NewRows(userColumns).
			AddRow(int64(55), "student", "hash", "Stu", (*string)(nil), "Dent", (*int64)(nil), now, now, false, false))

	var got identity
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(withAuth(7, true))
	req.Header.Set(actAsHeader, "55")
	rr := httptest.NewRecorder()

	ImpersonationMiddleware(database)(captureIdentity(&got)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if got.userID != 55 {
		t.Errorf("effective user id: got %d, want 55", got.userID)
	}
	if got.isAdmin {
		t.Error("effective is_admin should follow the (non-admin) target, not the real admin")
	}
	if !got.hasRealUser || got.realUserID != 7 {
		t.Errorf("real user id: got %d (present=%v), want 7", got.realUserID, got.hasRealUser)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestImpersonation_NonAdminHeaderIgnored(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	database := db.NewWithPool(mock)

	// No DB expectations: a non-admin must never trigger the target lookup.
	var got identity
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(withAuth(7, false))
	req.Header.Set(actAsHeader, "55")
	rr := httptest.NewRecorder()

	ImpersonationMiddleware(database)(captureIdentity(&got)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if got.userID != 7 || got.isAdmin {
		t.Errorf("identity must be untouched for non-admin: got id=%d admin=%v", got.userID, got.isAdmin)
	}
	if got.hasRealUser {
		t.Error("real user id must not be set when impersonation is not applied")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB activity: %v", err)
	}
}

func TestImpersonation_UnknownTargetBadRequest(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	database := db.NewWithPool(mock)

	mock.ExpectQuery(`SELECT .* FROM users WHERE id = \$1`).
		WithArgs(int64(404)).
		WillReturnError(pgx.ErrNoRows)

	called := false
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(withAuth(7, true))
	req.Header.Set(actAsHeader, "404")
	rr := httptest.NewRecorder()

	ImpersonationMiddleware(database)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
	if called {
		t.Error("next handler must not run when the act-as target is unknown")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestImpersonation_InvalidHeaderBadRequest(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	database := db.NewWithPool(mock)

	// No DB expectations: a non-numeric id is rejected before any lookup.
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(withAuth(7, true))
	req.Header.Set(actAsHeader, "not-a-number")
	rr := httptest.NewRecorder()

	ImpersonationMiddleware(database)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("next handler must not run on an invalid act-as id")
	})).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB activity: %v", err)
	}
}

func TestImpersonation_NoHeaderIsNoOp(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	database := db.NewWithPool(mock)

	var got identity
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(withAuth(7, true))
	rr := httptest.NewRecorder()

	ImpersonationMiddleware(database)(captureIdentity(&got)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if got.userID != 7 || !got.isAdmin {
		t.Errorf("identity must pass through untouched: got id=%d admin=%v", got.userID, got.isAdmin)
	}
	if got.hasRealUser {
		t.Error("real user id must not be set without the header")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB activity: %v", err)
	}
}
