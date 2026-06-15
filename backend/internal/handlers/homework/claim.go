package homework

import (
	"errors"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/jackc/pgx/v5"
)

// Claim — teacher of the thread's center. Atomically takes the soft lock
// if no live claim exists (or the caller already owns it). Returns the
// full threadView (same shape as the GET endpoint) so the client can
// re-render in place without a follow-up fetch. Returns 409 if another
// grader holds a live claim.
func Claim(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, err := pathInt64(r, "threadID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid thread id")
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get thread for claim", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}

		if _, err := q.TryClaim(ctx, store.TryClaimParams{
			ID:           threadID,
			GraderUserID: userID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "thread is currently claimed by another grader")
				return
			}
			logger.LogErrorContext(ctx, "homework: try claim", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		// Same response shape as /grade, /retract, /submit, /appeal — the
		// frontend's claimThread() is typed as ThreadView and uses
		// thread.events for the timeline; returning the raw store row
		// would crash render-time .events access.
		writeThreadView(ctx, w, r, database, blobs, threadID)
	}
}

// Heartbeat — must be the current claim holder. Extends the lease by 15min.
// 409 if the lock has expired or was stolen.
func Heartbeat(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, err := pathInt64(r, "threadID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid thread id")
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get thread for heartbeat", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}

		affected, err := q.HeartbeatClaim(ctx, store.HeartbeatClaimParams{
			ID:           threadID,
			GraderUserID: userID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: heartbeat claim", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "claim expired or no longer held")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Release — must be the current claim holder. Idempotent: a no-op release
// still returns 204 so clients can fire-and-forget on unmount.
func Release(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, err := pathInt64(r, "threadID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid thread id")
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get thread for release", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}

		if _, err := q.ReleaseClaim(ctx, store.ReleaseClaimParams{
			ID:           threadID,
			GraderUserID: userID,
		}); err != nil {
			logger.LogErrorContext(ctx, "homework: release claim", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
