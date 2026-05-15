package homework

import (
	"errors"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/jackc/pgx/v5"
)

// AppealGrade — student requests a regrade after a 'rejected' verdict. The
// appeal event refers to the rejection it disputes (refers_to_event_id =
// thread.CurrentGradeEventID). The thread's last_grader_user_id is left
// alone so the grader queue routes the appeal back to the same person.
//
// Unlike SubmitAttempt, appeals are NOT blocked by series.due_at — a
// rejection may have landed after due, and the student still deserves a
// channel.
func AppealGrade(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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

		thread, err := q.GetThreadByStudentAndSubproblem(ctx, store.GetThreadByStudentAndSubproblemParams{
			StudentUserID: userID,
			SubproblemID:  subproblemID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no submission to appeal")
				return
			}
			logger.LogError("homework: get thread for appeal", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if thread.CurrentStatus != homework.StatusRejected {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "appeal only allowed after a rejection")
			return
		}

		photos, vErr := validateAndStatPhotos(ctx, blobs, thread.ID, req.EventUUID, req.ObjectKeys)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		if err := writeAttempt(ctx, database, thread.ID, req.EventUUID, homework.KindAppealed, userID, body, photos, thread.CurrentGradeEventID); err != nil {
			logger.LogError("homework: appeal tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to record appeal")
			return
		}
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}
