package homework

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// offlineAcceptRequest marks a (student, subproblem) solution accepted in
// person. GraderUserID/GraderName carry the credited grader for the shared
// «кондуит»: when GraderUserID resolves to a registered teacher we credit
// them, otherwise GraderName is a free-text fallback. When BOTH are omitted
// (the phone flow) the authenticated teacher is credited.
type offlineAcceptRequest struct {
	StudentUserID int64  `json:"student_user_id"`
	SubproblemID  int64  `json:"subproblem_id"`
	GraderUserID  *int64 `json:"grader_user_id"`
	GraderName    string `json:"grader_name"`
}

// OfflineAccept — teacher of the center (the session account is the event
// actor). Find-or-creates the thread and appends an 'accepted_offline'
// event that supersedes any prior state, recording the credited grader.
func OfflineAccept(database *db.DB, hub *live.Hub, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		var req offlineAcceptRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.StudentUserID <= 0 || req.SubproblemID <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "student_user_id and subproblem_id are required")
			return
		}

		q := store.New(database.Pool())
		spCtx, err := q.GetSubproblemContext(ctx, req.SubproblemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: offline accept subproblem ctx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, spCtx.MathCenterID) {
			return
		}

		creditedUserID, creditedName, vErr := resolveCreditedGrader(ctx, q, userID, spCtx.MathCenterID, req)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		thread, err := q.FindOrCreateThread(ctx, store.FindOrCreateThreadParams{
			StudentUserID: req.StudentUserID,
			SubproblemID:  spCtx.SubproblemID,
			SeriesID:      spCtx.SeriesID,
			MathCenterID:  spCtx.MathCenterID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: offline find-or-create thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		// Already accepted (online or offline) → nothing to do. Returning a
		// 409 keeps the action explicit; the conduit only taps un-accepted
		// cells to accept and uses /offline/undo to reverse.
		if thread.CurrentStatus == homework.StatusAccepted {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "already accepted")
			return
		}
		if err := homework.CanTransition(thread.CurrentStatus, homework.KindAcceptedOffline); err != nil {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, err.Error())
			return
		}

		eventUUID, err := homework.NewEventUUID()
		if err != nil {
			logger.LogErrorContext(ctx, "homework: gen offline accept uuid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if err := writeOfflineAccept(ctx, database, thread, eventUUID, userID, creditedUserID, creditedName); err != nil {
			logger.LogErrorContext(ctx, "homework: offline accept tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to record offline accept")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: thread.MathCenterID, Kind: live.KindGrading, SeriesID: thread.SeriesID})
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}

// offlineUndoRequest reverses a prior offline accept on a (student,
// subproblem) thread.
type offlineUndoRequest struct {
	StudentUserID int64 `json:"student_user_id"`
	SubproblemID  int64 `json:"subproblem_id"`
}

// OfflineUndo — teacher of the center. Reverts an offline accept: appends an
// 'offline_retracted' event and rolls the thread back to its prior attempt
// state (or 'ungraded' when there was none). 409 if the current grade isn't
// an offline accept, so an online grade can't be undone through this path.
func OfflineUndo(database *db.DB, hub *live.Hub, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		var req offlineUndoRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.StudentUserID <= 0 || req.SubproblemID <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "student_user_id and subproblem_id are required")
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThreadByStudentAndSubproblem(ctx, store.GetThreadByStudentAndSubproblemParams{
			StudentUserID: req.StudentUserID,
			SubproblemID:  req.SubproblemID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: offline undo get thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}
		if err := homework.CanTransition(thread.CurrentStatus, homework.KindOfflineRetracted); err != nil {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "thread is not accepted")
			return
		}
		// Guard: only an offline accept may be undone here. An online grade
		// must go through the claim-aware /retract path.
		if thread.CurrentGradeEventID == nil {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "no grade to undo")
			return
		}
		gradeEvent, err := q.GetEvent(ctx, *thread.CurrentGradeEventID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: offline undo get grade event", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !gradeEvent.IsOffline {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "current grade is not an offline accept")
			return
		}

		rollback, err := offlineRollbackStatus(ctx, q, thread)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: offline undo rollback status", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		eventUUID, err := homework.NewEventUUID()
		if err != nil {
			logger.LogErrorContext(ctx, "homework: gen offline undo uuid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if err := writeOfflineUndo(ctx, database, thread.ID, eventUUID, userID, gradeEvent.ID, rollback); err != nil {
			logger.LogErrorContext(ctx, "homework: offline undo tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to undo offline accept")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: thread.MathCenterID, Kind: live.KindGrading, SeriesID: thread.SeriesID})
		writeThreadView(ctx, w, r, database, blobs, thread.ID)
	}
}

// resolveCreditedGrader determines who to credit for an offline accept:
//   - GraderUserID set → must be a teacher of the center; credit their full name.
//   - else GraderName set → free-text fallback (an unregistered grader).
//   - else → the authenticated session user (the phone flow).
//
// Returns (creditedUserID, creditedName, errMsg).
func resolveCreditedGrader(ctx context.Context, q *store.Queries, sessionUserID, centerID int64, req offlineAcceptRequest) (*int64, string, string) {
	if req.GraderUserID != nil {
		isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
			UserID: *req.GraderUserID, MathCenterID: centerID,
		})
		if err != nil {
			return nil, "", "failed to validate credited grader"
		}
		if !isTeacher {
			return nil, "", "credited grader must be a teacher of this center"
		}
		name, err := graderFullName(ctx, q, *req.GraderUserID)
		if err != nil {
			return nil, "", "credited grader not found"
		}
		return req.GraderUserID, name, ""
	}
	if name, err := homework.CreditedName("", "", req.GraderName); err == nil && req.GraderName != "" {
		return nil, name, ""
	}
	// Phone flow: credit the authenticated teacher.
	name, err := graderFullName(ctx, q, sessionUserID)
	if err != nil {
		return nil, "", "grader name is required"
	}
	return &sessionUserID, name, ""
}

// graderFullName looks up a user's "Имя Фамилия" for crediting.
func graderFullName(ctx context.Context, q *store.Queries, userID int64) (string, error) {
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	name := homework.FullName(u.FirstName, u.LastName)
	if name == "" {
		return "", fmt.Errorf("user %d has no name", userID)
	}
	return name, nil
}

// offlineRollbackStatus restores the state an offline accept superseded:
// the most recent attempt's pending status, or 'ungraded' when there was
// never an online submission behind it.
func offlineRollbackStatus(ctx context.Context, q *store.Queries, thread store.HomeworkThread) (string, error) {
	if thread.CurrentAttemptEventID == nil {
		return homework.StatusUngraded, nil
	}
	kind, err := q.GetEventKind(ctx, *thread.CurrentAttemptEventID)
	if err != nil {
		return "", err
	}
	if kind == homework.KindAppealed {
		return homework.StatusAppealed, nil
	}
	return homework.StatusSubmitted, nil
}

// writeOfflineAccept appends the accepted_offline event and flips the cache
// to accepted in one tx so the timeline and cache can't disagree.
func writeOfflineAccept(ctx context.Context, database *db.DB, thread store.HomeworkThread, eventUUID string, actorUserID int64, creditedUserID *int64, creditedName string) error {
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qx := store.New(tx)
	verdict := homework.VerdictAccepted
	event, err := qx.AppendOfflineEvent(ctx, store.AppendOfflineEventParams{
		ThreadID:             thread.ID,
		EventUuid:            eventUUID,
		Kind:                 homework.KindAcceptedOffline,
		ActorUserID:          actorUserID,
		Body:                 "",
		Verdict:              &verdict,
		RefersToEventID:      nil,
		CreditedGraderUserID: creditedUserID,
		CreditedGraderName:   creditedName,
	})
	if err != nil {
		return fmt.Errorf("append accepted_offline event: %w", err)
	}
	if err := qx.UpdateThreadAfterOfflineAccept(ctx, store.UpdateThreadAfterOfflineAcceptParams{
		GradeEventID: event.ID,
		GraderUserID: creditedUserID,
		GraderName:   creditedName,
		ID:           thread.ID,
	}); err != nil {
		return fmt.Errorf("update thread after offline accept: %w", err)
	}
	return tx.Commit(ctx)
}

// writeOfflineUndo appends the offline_retracted event and rolls the cache
// back in one tx.
func writeOfflineUndo(ctx context.Context, database *db.DB, threadID int64, eventUUID string, actorUserID, gradeEventID int64, rollback string) error {
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qx := store.New(tx)
	if _, err := qx.AppendOfflineEvent(ctx, store.AppendOfflineEventParams{
		ThreadID:             threadID,
		EventUuid:            eventUUID,
		Kind:                 homework.KindOfflineRetracted,
		ActorUserID:          actorUserID,
		Body:                 "",
		Verdict:              nil,
		RefersToEventID:      &gradeEventID,
		CreditedGraderUserID: nil,
		CreditedGraderName:   "",
	}); err != nil {
		return fmt.Errorf("append offline_retracted event: %w", err)
	}
	if err := qx.UpdateThreadAfterOfflineUndo(ctx, store.UpdateThreadAfterOfflineUndoParams{
		RollbackStatus: rollback,
		ID:             threadID,
	}); err != nil {
		return fmt.Errorf("update thread after offline undo: %w", err)
	}
	return tx.Commit(ctx)
}
