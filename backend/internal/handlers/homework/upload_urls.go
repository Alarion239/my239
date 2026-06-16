package homework

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// uploadURLsRequest is the body for both /upload-urls endpoints. One slot
// per ContentType the client intends to upload; the response carries the
// presigned URLs in matching order.
type uploadURLsRequest struct {
	ContentTypes []string `json:"content_types"`
}

// uploadSlot is one (key, signed PUT URL) pair the client uses to upload
// one photo. The client must echo ObjectKey back to the finalize handler
// (submit / appeal / grade) so the server knows which object to Stat.
type uploadSlot struct {
	Index       int    `json:"index"`
	ObjectKey   string `json:"object_key"`
	UploadURL   string `json:"upload_url"`
	ContentType string `json:"content_type"`
}

// uploadURLsResponse bundles a server-allocated event UUID with the per-
// photo slots. The client passes EventUUID back on the matching finalize
// call so server-allocated and server-validated keys line up.
type uploadURLsResponse struct {
	EventUUID string       `json:"event_uuid"`
	Slots     []uploadSlot `json:"slots"`
}

// IssueStudentUploadURLs — student of the subproblem's center. Used before
// /submit (first attempt or resubmission) and /appeal. Mints one presigned
// PUT URL per requested content_type. We don't reveal the bucket name to
// the client; the URL host comes from S3.PublicEndpoint (or the bucket's
// real host in prod) and is signed for the exact ContentType the client
// commits to, so the browser PUT must include that header verbatim.
func IssueStudentUploadURLs(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
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

		var req uploadURLsRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if err := homework.ValidatePhotoBatch(req.ContentTypes); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}

		q := store.New(database.Pool())
		spCtx, err := q.GetSubproblemContext(ctx, subproblemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: subproblem ctx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireStudent(ctx, w, r, q, userID, spCtx.MathCenterID) {
			return
		}

		thread, err := q.FindOrCreateThread(ctx, store.FindOrCreateThreadParams{
			StudentUserID: userID,
			SubproblemID:  spCtx.SubproblemID,
			SeriesID:      spCtx.SeriesID,
			MathCenterID:  spCtx.MathCenterID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: find-or-create thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		slots, eventUUID, err := mintSlots(ctx, blobs, thread.ID, req.ContentTypes, uploadTTL)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: presign put", err)
			httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, uploadURLsResponse{EventUUID: eventUUID, Slots: slots})
	}
}

// IssueGraderUploadURLs — teacher of the thread's center. Used before
// /grade when the grader wants to attach a comment photo (e.g. annotated
// geometry diagram). Same minting logic; different auth.
func IssueGraderUploadURLs(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
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

		var req uploadURLsRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if err := homework.ValidatePhotoBatch(req.ContentTypes); err != nil {
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
			logger.LogErrorContext(ctx, "homework: get thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}

		slots, eventUUID, err := mintSlots(ctx, blobs, thread.ID, req.ContentTypes, uploadTTL)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: presign put", err)
			httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, uploadURLsResponse{EventUUID: eventUUID, Slots: slots})
	}
}

// mintSlots is the shared body of both upload-url handlers: allocate one
// event UUID, derive a key for each content type via the canonical layout
// (so finalize handlers can recompute and verify the prefix), and presign
// each PUT URL for the corresponding content type.
func mintSlots(ctx context.Context, blobs objectstore.Store, threadID int64, contentTypes []string, ttl time.Duration) ([]uploadSlot, string, error) {
	eventUUID, err := homework.NewEventUUID()
	if err != nil {
		return nil, "", err
	}
	out := make([]uploadSlot, 0, len(contentTypes))
	for i, ct := range contentTypes {
		ext, ok := homework.ExtForContentType(ct)
		if !ok {
			// ValidatePhotoBatch already screened this; defense in depth.
			return nil, "", errors.New("unsupported content_type")
		}
		key := homework.ObjectKey(threadID, eventUUID, i, ext)
		url, err := blobs.PresignPut(ctx, key, ct, ttl)
		if err != nil {
			return nil, "", err
		}
		out = append(out, uploadSlot{
			Index:       i,
			ObjectKey:   key,
			UploadURL:   url,
			ContentType: ct,
		})
	}
	return out, eventUUID, nil
}
