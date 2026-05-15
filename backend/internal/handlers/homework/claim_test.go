package homework_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func TestClaim_GrantsWhenFree(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: "submitted"}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectQuery(`UPDATE homework_thread\s+SET claim_holder_user_id`).
		WithArgs(int64(3), int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", ClaimHolderID: ptr64(3), ClaimExpiresAt: ptrTime(now.Add(15 * time.Minute)),
		}, now)...))
	// Claim now returns the full threadView so the client doesn't crash
	// on .events access; that means a writeThreadView round-trip after
	// TryClaim succeeds (re-fetches thread, fetches series, lists events).
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", ClaimHolderID: ptr64(3), ClaimExpiresAt: ptrTime(now.Add(15 * time.Minute)),
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestClaim_ConflictWhenHeldByOther(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	heldBy := int64(99)
	exp := now.Add(10 * time.Minute)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", ClaimHolderID: &heldBy, ClaimExpiresAt: &exp,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	// TryClaim returns no rows (UPDATE didn't match).
	mock.ExpectQuery(`UPDATE homework_thread\s+SET claim_holder_user_id`).
		WithArgs(int64(3), int64(1)).
		WillReturnError(pgx.ErrNoRows)

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409", rr.Code)
	}
}

func TestClaim_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, false)

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestHeartbeat_RejectsWhenNotHolder(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectExec(`UPDATE homework_thread\s+SET claim_expires_at`).
		WithArgs(int64(1), int64(3)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim/heartbeat", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409", rr.Code)
	}
}

func TestHeartbeat_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectExec(`UPDATE homework_thread\s+SET claim_expires_at`).
		WithArgs(int64(1), int64(3)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim/heartbeat", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("got %d, want 204", rr.Code)
	}
}

func TestRelease_IsIdempotent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	// Even when zero rows are affected (lock already gone), Release
	// returns 204.
	mock.ExpectExec(`UPDATE homework_thread\s+SET claim_holder_user_id\s+= NULL`).
		WithArgs(int64(1), int64(3)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/claim/release", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("got %d, want 204", rr.Code)
	}
}

// ptr64 / ptrTime are local helpers so tests can pass &literal cleanly.
func ptr64(v int64) *int64           { return &v }
func ptrTime(v time.Time) *time.Time { return &v }
