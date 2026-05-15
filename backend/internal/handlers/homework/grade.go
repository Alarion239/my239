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

// gradeRequest is the body of /grade. Verdict is "accepted" or "rejected".
// Body is the required text comment ("the grade should come with a text
// comment"). ObjectKeys are optional photo comment(s).
type gradeRequest struct {
	Verdict    string   `json:"verdict"`
	Body       string   `json:"body"`
	EventUUID  string   `json:"event_uuid"`
	ObjectKeys []string `json:"object_keys"`
}

// Grade — teacher of center, must hold the claim. Appends a 'graded' event
// (verdict accepted/rejected, with optional photo comment), flips the
// thread cache to the new status, records last_grader_user_id for appeal
// stickiness, and clears the claim — all atomically. For 'appealed'
// threads, only the original grader (last_grader_user_id) or an admin may
// grade.
func Grade(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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

		var req gradeRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		verdict, body, vErr := validateGradeInput(req)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogError("homework: get thread for grade", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}

		// Only legal from 'submitted' or 'appealed' (grade after attempt).
		if err := homework.CanTransition(thread.CurrentStatus, homework.KindGraded); err != nil {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, err.Error())
			return
		}

		// Appeal stickiness: only the original grader can resolve an
		// appeal (or an admin). Without this, a different grader could
		// silently undo a colleague's verdict.
		if thread.CurrentStatus == homework.StatusAppealed {
			if !callerIsAdmin(r) && (thread.LastGraderUserID == nil || *thread.LastGraderUserID != userID) {
				httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "appeals must be answered by the original grader")
				return
			}
		}

		photos, vErr := validateAndStatPhotos(ctx, blobs, thread.ID, req.EventUUID, req.ObjectKeys)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		if err := writeGrade(ctx, database, thread, req.EventUUID, userID, verdict, body, photos); err != nil {
			if errors.Is(err, errClaimContention) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "claim expired or held by another grader")
				return
			}
			logger.LogError("homework: grade tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to record grade")
			return
		}
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}

// validateGradeInput enforces the contract from the spec: verdict in
// {accepted, rejected}, body non-empty within MaxBodyChars.
func validateGradeInput(req gradeRequest) (verdict, body, errMsg string) {
	switch req.Verdict {
	case homework.VerdictAccepted, homework.VerdictRejected:
		verdict = req.Verdict
	default:
		return "", "", "verdict must be 'accepted' or 'rejected'"
	}
	cleaned, err := homework.ValidateBody(req.Body)
	if err != nil {
		return "", "", err.Error()
	}
	if cleaned == "" {
		return "", "", "body (grader comment) is required"
	}
	if req.EventUUID == "" || len(req.EventUUID) > 64 {
		return "", "", "event_uuid is required"
	}
	if len(req.ObjectKeys) > homework.MaxPhotosPerEvent {
		return "", "", fmt.Sprintf("at most %d photos per event", homework.MaxPhotosPerEvent)
	}
	return verdict, cleaned, ""
}

// errClaimContention signals that UpdateThreadAfterGrade affected zero
// rows because the claim was no longer held by the caller — translates to
// 409 in the handler.
var errClaimContention = errors.New("homework: claim contention")

// writeGrade commits a graded event + photos + cache update in one
// transaction. UpdateThreadAfterGrade's WHERE clause re-checks claim
// ownership, so a slow grader whose lease has expired cannot land a grade
// on top of someone else's claim.
func writeGrade(ctx context.Context, database *db.DB, thread store.HomeworkThread, eventUUID string, graderUserID int64, verdict, body string, photos []validatedPhoto) error {
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qx := store.New(tx)
	event, err := qx.AppendEvent(ctx, store.AppendEventParams{
		ThreadID:        thread.ID,
		EventUuid:       eventUUID,
		Kind:            homework.KindGraded,
		ActorUserID:     graderUserID,
		Body:            body,
		Verdict:         &verdict,
		RefersToEventID: thread.CurrentAttemptEventID,
	})
	if err != nil {
		return fmt.Errorf("append grade event: %w", err)
	}
	for _, p := range photos {
		if err := qx.InsertEventPhoto(ctx, store.InsertEventPhotoParams{
			EventID:     event.ID,
			Idx:         int32(p.Idx),
			ObjectKey:   p.ObjectKey,
			SizeBytes:   p.Size,
			ContentType: p.ContentType,
		}); err != nil {
			return fmt.Errorf("insert grade photo %d: %w", p.Idx, err)
		}
	}
	affected, err := qx.UpdateThreadAfterGrade(ctx, store.UpdateThreadAfterGradeParams{
		Verdict:      verdict,
		GradeEventID: event.ID,
		GraderUserID: graderUserID,
		ID:           thread.ID,
	})
	if err != nil {
		return fmt.Errorf("update thread after grade: %w", err)
	}
	if affected == 0 {
		return errClaimContention
	}
	return tx.Commit(ctx)
}
