package homework

import (
	"net/http"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// graderStatsResponse is the grader dashboard counter set: items waiting
// to be picked up center-wide, items the caller currently holds, and
// appeals routed back to the caller.
type graderStatsResponse struct {
	PendingCount   int64 `json:"pending_count"`
	MyClaimedCount int64 `json:"my_claimed_count"`
	MyAppealsCount int64 `json:"my_appeals_count"`
}

// GraderStats — teacher of the center. Single-row count summary for the
// dashboard ("3 to grade, 1 you're already on, 2 appeals waiting for you").
func GraderStats(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		centerID, err := pathInt64(r, "centerID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
			return
		}

		q := store.New(database.Pool())
		if !requireTeacher(ctx, w, r, q, userID, centerID) {
			return
		}

		row, err := q.GraderStatsForCenter(ctx, store.GraderStatsForCenterParams{
			MathCenterID: centerID,
			CallerUserID: userID,
		})
		if err != nil {
			logger.LogError("homework: grader stats", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, graderStatsResponse{
			PendingCount:   row.PendingCount,
			MyClaimedCount: row.MyClaimedCount,
			MyAppealsCount: row.MyAppealsCount,
		})
	}
}
