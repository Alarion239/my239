package homework

import (
	"errors"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

// rollupSubproblem is the per-subpart cell in the student's status grid.
// Label is empty for sentinel subproblems (problems without real subparts) —
// the frontend renders those as the bare problem header.
type rollupSubproblem struct {
	SubproblemID    int64  `json:"subproblem_id"`
	SubproblemLabel string `json:"subproblem_label"`
	ThreadID        int64  `json:"thread_id"`
	CurrentStatus   string `json:"current_status"`
}

// rollupProblem groups subproblems by problem.
type rollupProblem struct {
	ProblemID      int64              `json:"problem_id"`
	ProblemNumber  int                `json:"problem_number"`
	ProblemDisplay string             `json:"problem_display"`
	Subproblems    []rollupSubproblem `json:"subproblems"`
}

// rollupCounts is the "X accepted / Y rejected / Z still to do" card on
// the student dashboard.
type rollupCounts struct {
	Accepted int64 `json:"accepted"`
	Rejected int64 `json:"rejected"`
	Pending  int64 `json:"pending"`
}

// myRollupResponse is the full student view: counters + the per-problem
// grid in one round-trip.
type myRollupResponse struct {
	Counts   rollupCounts    `json:"counts"`
	Problems []rollupProblem `json:"problems"`
}

// MySeriesRollup — student of the series's center. Returns the per-
// subproblem status grid plus the count summary. Drafts (unpublished
// series) return 404 to the student to match mathcenter visibility.
func MySeriesRollup(database *db.DB) http.HandlerFunc {
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

		q := store.New(database.Pool())
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get series for rollup", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireStudent(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		if series.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return
		}

		rows, err := q.StudentSeriesRollup(ctx, store.StudentSeriesRollupParams{
			SeriesID:      seriesID,
			StudentUserID: userID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: student rollup", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		counts, err := q.StudentSeriesCounts(ctx, store.StudentSeriesCountsParams{
			SeriesID:      seriesID,
			StudentUserID: userID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: student counts", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// Group rows by problem. Rows already arrive ordered by problem
		// number, so a simple last-seen tracker is enough.
		var problems []rollupProblem
		var current *rollupProblem
		for _, row := range rows {
			if current == nil || current.ProblemID != row.ProblemID {
				problems = append(problems, rollupProblem{
					ProblemID:      row.ProblemID,
					ProblemNumber:  int(row.ProblemNumber),
					ProblemDisplay: mc.ProblemDisplayName(int(row.ProblemNumber)),
					Subproblems:    []rollupSubproblem{},
				})
				current = &problems[len(problems)-1]
			}
			current.Subproblems = append(current.Subproblems, rollupSubproblem{
				SubproblemID:    row.SubproblemID,
				SubproblemLabel: row.SubproblemLabel,
				ThreadID:        row.ThreadID,
				CurrentStatus:   row.CurrentStatus,
			})
		}
		if problems == nil {
			problems = []rollupProblem{}
		}
		httpx.WriteJSON(w, http.StatusOK, myRollupResponse{
			Counts: rollupCounts{
				Accepted: counts.AcceptedCount,
				Rejected: counts.RejectedCount,
				Pending:  counts.PendingCount,
			},
			Problems: problems,
		})
	}
}
