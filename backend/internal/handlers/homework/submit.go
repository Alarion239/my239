package homework

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/jackc/pgx/v5"
)

// submitRequest is the body of /submit and /appeal. EventUUID is the UUID
// returned by the matching upload-urls call; ObjectKeys are the keys the
// client just PUT to (or empty for a text-only submission).
type submitRequest struct {
	EventUUID  string   `json:"event_uuid"`
	Body       string   `json:"body"`
	ObjectKeys []string `json:"object_keys"`
}

// SubmitAttempt — student finalizes a submission (initial attempt OR
// resubmission after rejection). Appends a 'submitted' event with the
// provided photo keys, and points the thread's cache at that event.
// Blocked after series.due_at.
func SubmitAttempt(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		subproblemID, err := pathInt64(r, "subproblemID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid subproblem id")
			return
		}

		var req submitRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		body, vErr := validateSubmitInput(req)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		q := store.New(database.Pool())
		spCtx, err := q.GetSubproblemContext(ctx, subproblemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
				return
			}
			logger.LogError("homework: subproblem ctx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireStudent(ctx, w, r, q, userID, spCtx.MathCenterID) {
			return
		}
		// Submissions close at the due time. Appeals are NOT blocked by
		// due (a rejection might land post-due and the student still
		// deserves a regrade path).
		if !time.Now().Before(spCtx.SeriesDueAt) {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "submissions closed for this series")
			return
		}

		thread, err := q.FindOrCreateThread(ctx, store.FindOrCreateThreadParams{
			StudentUserID: userID,
			SubproblemID:  spCtx.SubproblemID,
			SeriesID:      spCtx.SeriesID,
			MathCenterID:  spCtx.MathCenterID,
		})
		if err != nil {
			logger.LogError("homework: find-or-create thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// Submission is legal from 'ungraded' (first attempt) and from
		// 'rejected' (resubmission). Other states (submitted, appealed,
		// accepted) are deliberately blocked.
		if err := homework.CanTransition(thread.CurrentStatus, homework.KindSubmitted); err != nil {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, err.Error())
			return
		}

		// Verify every claimed object exists, matches policy, and lives
		// under the prefix this server would have signed.
		photos, vErr := validateAndStatPhotos(ctx, blobs, thread.ID, req.EventUUID, req.ObjectKeys)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		if err := writeAttempt(ctx, database, thread.ID, req.EventUUID, homework.KindSubmitted, userID, body, photos, nil); err != nil {
			logger.LogError("homework: submit tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save submission")
			return
		}
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}

// validateSubmitInput trims/checks the request fields shared by submit and
// appeal. Returns (cleanedBody, "") on success or ("", reason) on failure.
func validateSubmitInput(req submitRequest) (string, string) {
	if strings.TrimSpace(req.EventUUID) == "" {
		return "", "event_uuid is required"
	}
	if len(req.EventUUID) > 64 {
		return "", "event_uuid is malformed"
	}
	body, err := homework.ValidateBody(req.Body)
	if err != nil {
		return "", err.Error()
	}
	if len(req.ObjectKeys) > homework.MaxPhotosPerEvent {
		return "", fmt.Sprintf("at most %d photos per event", homework.MaxPhotosPerEvent)
	}
	return body, ""
}

// validatedPhoto is the per-photo record we'll insert after Stat-validating
// the upload.
type validatedPhoto struct {
	Idx         int
	ObjectKey   string
	Size        int64
	ContentType string
}

// validateAndStatPhotos refuses anything that wasn't placed under the
// canonical key prefix the server signed, that doesn't exist in the bucket,
// or that exceeds the size/MIME policy.
func validateAndStatPhotos(ctx context.Context, blobs objectstore.Store, threadID int64, eventUUID string, keys []string) ([]validatedPhoto, string) {
	prefix := homework.ObjectKeyPrefix(threadID, eventUUID)
	out := make([]validatedPhoto, 0, len(keys))
	for i, k := range keys {
		if !strings.HasPrefix(k, prefix) {
			return nil, fmt.Sprintf("object_key %d outside event prefix", i)
		}
		size, ct, err := blobs.Stat(ctx, k)
		if err != nil {
			if errors.Is(err, objectstore.ErrNotFound) {
				return nil, fmt.Sprintf("object_key %d not uploaded", i)
			}
			return nil, fmt.Sprintf("object_key %d: storage unavailable", i)
		}
		if _, ok := homework.ExtForContentType(ct); !ok {
			return nil, fmt.Sprintf("object_key %d has unsupported content_type %q", i, ct)
		}
		if size <= 0 || size > homework.MaxPhotoBytes {
			return nil, fmt.Sprintf("object_key %d exceeds size limit", i)
		}
		out = append(out, validatedPhoto{Idx: i, ObjectKey: k, Size: size, ContentType: ct})
	}
	return out, ""
}

// writeAttempt commits a submit-or-appeal in a single transaction:
// AppendEvent → InsertEventPhoto × N → UpdateThreadAfter{Submit,Appeal}.
// kind is "submitted" or "appealed"; refersTo is nil for submit, the
// graded-event id for appeal.
func writeAttempt(ctx context.Context, database *db.DB, threadID int64, eventUUID, kind string, actorUserID int64, body string, photos []validatedPhoto, refersTo *int64) error {
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	// Rollback is a no-op after a successful Commit; safe to defer
	// unconditionally and keeps the error path tight.
	defer func() { _ = tx.Rollback(ctx) }()

	qx := store.New(tx)
	event, err := qx.AppendEvent(ctx, store.AppendEventParams{
		ThreadID:        threadID,
		EventUuid:       eventUUID,
		Kind:            kind,
		ActorUserID:     actorUserID,
		Body:            body,
		Verdict:         nil,
		RefersToEventID: refersTo,
	})
	if err != nil {
		return fmt.Errorf("append event: %w", err)
	}
	for _, p := range photos {
		if err := qx.InsertEventPhoto(ctx, store.InsertEventPhotoParams{
			EventID:     event.ID,
			Idx:         int32(p.Idx),
			ObjectKey:   p.ObjectKey,
			SizeBytes:   p.Size,
			ContentType: p.ContentType,
		}); err != nil {
			return fmt.Errorf("insert photo %d: %w", p.Idx, err)
		}
	}
	switch kind {
	case homework.KindSubmitted:
		if err := qx.UpdateThreadAfterSubmit(ctx, store.UpdateThreadAfterSubmitParams{
			ID:                    threadID,
			CurrentAttemptEventID: &event.ID,
		}); err != nil {
			return fmt.Errorf("update thread after submit: %w", err)
		}
	case homework.KindAppealed:
		if err := qx.UpdateThreadAfterAppeal(ctx, store.UpdateThreadAfterAppealParams{
			ID:                    threadID,
			CurrentAttemptEventID: &event.ID,
		}); err != nil {
			return fmt.Errorf("update thread after appeal: %w", err)
		}
	default:
		return fmt.Errorf("writeAttempt: unexpected kind %q", kind)
	}
	return tx.Commit(ctx)
}
