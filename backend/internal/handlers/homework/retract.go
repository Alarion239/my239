package homework

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/jackc/pgx/v5"
)

// retractRequest is the body of /retract. Body is an optional reason
// (helpful for the audit trail; the timeline shows it to the student).
type retractRequest struct {
	Body string `json:"body"`
}

// Retract — most recent grader OR admin. Undoes the latest 'graded'
// verdict on the thread. The thread rolls back to whatever its most recent
// attempt event was: 'submitted' or 'appealed'. Photos and the original
// grade event stay in the log for audit.
func Retract(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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

		var req retractRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		body, err := homework.ValidateBody(req.Body)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogError("homework: get thread for retract", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}
		// Only the grader who issued the verdict (or an admin) may
		// retract it — otherwise a different teacher could quietly undo
		// a colleague's call.
		if !callerIsAdmin(r) {
			if thread.LastGraderUserID == nil || *thread.LastGraderUserID != userID {
				httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "only the original grader can retract")
				return
			}
		}
		// Retraction only makes sense from a terminal verdict state.
		if thread.CurrentStatus != homework.StatusAccepted && thread.CurrentStatus != homework.StatusRejected {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "retraction only allowed after a verdict")
			return
		}

		gradedEvent, err := q.GetMostRecentGradedEvent(ctx, thread.ID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "no graded event to retract")
				return
			}
			logger.LogError("homework: get most recent grade", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		rollback, err := rollbackStatus(ctx, q, thread)
		if err != nil {
			logger.LogError("homework: rollback status", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		eventUUID, err := homework.NewEventUUID()
		if err != nil {
			logger.LogError("homework: gen retract uuid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if err := writeRetract(ctx, database, thread.ID, eventUUID, userID, body, gradedEvent.ID, rollback); err != nil {
			logger.LogError("homework: retract tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to retract")
			return
		}
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}

// rollbackStatus determines whether retracting puts the thread back to
// 'submitted' (the prior attempt was a fresh submission) or 'appealed'
// (the prior attempt was an appeal). Falls back to 'submitted' if for some
// reason there's no current attempt id — keeps the state machine moving
// even with degenerate data.
func rollbackStatus(ctx context.Context, q *store.Queries, thread store.HomeworkThread) (string, error) {
	if thread.CurrentAttemptEventID == nil {
		return homework.StatusSubmitted, nil
	}
	kind, err := q.GetEventKind(ctx, *thread.CurrentAttemptEventID)
	if err != nil {
		return "", err
	}
	switch kind {
	case homework.KindAppealed:
		return homework.StatusAppealed, nil
	case homework.KindSubmitted:
		return homework.StatusSubmitted, nil
	default:
		return homework.StatusSubmitted, nil
	}
}

// writeRetract appends a 'retracted' event referring to the rescinded
// grade, then flips the thread cache back to its prior attempt status,
// all in one tx so the cache and timeline can't disagree.
func writeRetract(ctx context.Context, database *db.DB, threadID int64, eventUUID string, actorUserID int64, body string, gradedEventID int64, rollback string) error {
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qx := store.New(tx)
	if _, err := qx.AppendEvent(ctx, store.AppendEventParams{
		ThreadID:        threadID,
		EventUuid:       eventUUID,
		Kind:            homework.KindRetracted,
		ActorUserID:     actorUserID,
		Body:            body,
		Verdict:         nil,
		RefersToEventID: &gradedEventID,
	}); err != nil {
		return fmt.Errorf("append retract event: %w", err)
	}
	if err := qx.UpdateThreadAfterRetract(ctx, store.UpdateThreadAfterRetractParams{
		ID:            threadID,
		CurrentStatus: rollback,
	}); err != nil {
		return fmt.Errorf("update thread after retract: %w", err)
	}
	return tx.Commit(ctx)
}
