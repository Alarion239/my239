package homework

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	hw "github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// problemStat is the per-subproblem breakdown of students by status. Each
// subproblem (e.g. 1а, 1б) is reported as its own line — they are never folded
// into a single problem. The five buckets are mutually exclusive, so
// accepted+appealed+rejected+submitted+unsolved == total_students for every row.
type problemStat struct {
	ProblemID       int64  `json:"problem_id"`
	ProblemNumber   int    `json:"problem_number"`
	ProblemDisplay  string `json:"problem_display"`
	SubproblemID    int64  `json:"subproblem_id"`
	SubproblemLabel string `json:"subproblem_label"`
	Accepted        int    `json:"accepted"`
	Appealed        int    `json:"appealed"`
	Rejected        int    `json:"rejected"`
	Submitted       int    `json:"submitted"`
	Unsolved        int    `json:"unsolved"`
}

// problemStatsResponse is the series-page teacher summary: the roster size plus
// one breakdown per subproblem, ordered by problem number then subproblem label.
type problemStatsResponse struct {
	TotalStudents int           `json:"total_students"`
	Problems      []problemStat `json:"problems"`
}

// ProblemStats — teacher of the series's center (admin is a superset, and the
// check is impersonation-aware via callerIsAdmin reading the effective claim).
// Returns, per problem, how many students of the center fall into each derived
// status bucket. Used by the teacher series page to gauge progress at a glance.
func ProblemStats(database *db.DB) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "homework: get series for problem stats", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		rows, err := q.SeriesProblemStats(ctx, seriesID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: series problem stats", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		total, problems := aggregateProblemStats(rows)
		httpx.WriteJSON(w, http.StatusOK, problemStatsResponse{
			TotalStudents: total,
			Problems:      problems,
		})
	}
}

// aggregateProblemStats counts the flat (student × subproblem) rows directly
// into per-subproblem bucket counts plus the distinct student total.
//
// Each input row carries one subproblem's status for one student; we tally that
// status straight into the subproblem's bucket. Subproblems are NOT folded into
// a parent problem — 1а and 1б are two independent lines. Every student of the
// center appears for every subproblem (the SQL crosses roster × subproblems), so
// the five buckets per subproblem always sum to the distinct student count.
func aggregateProblemStats(rows []store.SeriesProblemStatsRow) (totalStudents int, problems []problemStat) {
	type subKey = int64

	order := make([]subKey, 0)
	bySub := make(map[subKey]*problemStat)
	students := make(map[int64]struct{})

	for _, row := range rows {
		students[row.StudentUserID] = struct{}{}

		s, ok := bySub[row.SubproblemID]
		if !ok {
			s = &problemStat{
				ProblemID:       row.ProblemID,
				ProblemNumber:   int(row.ProblemNumber),
				ProblemDisplay:  mc.ProblemDisplayName(int(row.ProblemNumber)),
				SubproblemID:    row.SubproblemID,
				SubproblemLabel: row.SubproblemLabel,
			}
			bySub[row.SubproblemID] = s
			order = append(order, row.SubproblemID)
		}

		switch row.CurrentStatus {
		case hw.StatusAccepted:
			s.Accepted++
		case hw.StatusAppealed:
			s.Appealed++
		case hw.StatusRejected:
			s.Rejected++
		case hw.StatusSubmitted:
			s.Submitted++
		default: // ungraded (or any unknown status)
			s.Unsolved++
		}
	}

	for _, id := range order {
		problems = append(problems, *bySub[id])
	}
	if problems == nil {
		problems = []problemStat{}
	}
	return len(students), problems
}
