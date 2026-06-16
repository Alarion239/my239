package homework

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// queueItem is one row in the grader queue: enough info to render a list
// without N+1 lookups (student name, problem/subproblem label, claim
// state, current status).
type queueItem struct {
	ThreadID          int64      `json:"thread_id"`
	StudentUserID     int64      `json:"student_user_id"`
	StudentName       string     `json:"student_name"`
	SubproblemID      int64      `json:"subproblem_id"`
	SubproblemLabel   string     `json:"subproblem_label"`
	ProblemNumber     int        `json:"problem_number"`
	ProblemDisplay    string     `json:"problem_display"`
	CurrentStatus     string     `json:"current_status"`
	LastGraderUserID  *int64     `json:"last_grader_user_id,omitempty"`
	ClaimHolderUserID *int64     `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time `json:"claim_expires_at,omitempty"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// GraderQueue — teacher of the series's center. Returns items that need
// grading, optionally filtered to only those where the caller was the
// most recent grader (?mine=true). Items currently locked by someone else
// are excluded.
func GraderQueue(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		seriesID, err := pathInt64(r, "seriesID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid series id")
			return
		}
		mine, _ := strconv.ParseBool(r.URL.Query().Get("mine"))

		q := store.New(database.Pool())
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get series for queue", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		rows, err := q.ListGraderQueueForSeries(ctx, store.ListGraderQueueForSeriesParams{
			SeriesID:     seriesID,
			CallerUserID: userID,
			MineOnly:     mine,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: list grader queue", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		out := make([]queueItem, 0, len(rows))
		for _, row := range rows {
			out = append(out, queueItem{
				ThreadID:          row.ID,
				StudentUserID:     row.StudentUserID,
				StudentName:       mc.StudentDisplayName(row.StudentFirstName, row.StudentLastName),
				SubproblemID:      row.SubproblemID,
				SubproblemLabel:   row.SubproblemLabel,
				ProblemNumber:     int(row.ProblemNumber),
				ProblemDisplay:    mc.ProblemDisplayName(int(row.ProblemNumber)),
				CurrentStatus:     row.CurrentStatus,
				LastGraderUserID:  row.LastGraderUserID,
				ClaimHolderUserID: row.ClaimHolderUserID,
				ClaimExpiresAt:    row.ClaimExpiresAt,
				UpdatedAt:         row.UpdatedAt,
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}
