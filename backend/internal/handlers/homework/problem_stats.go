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

// problemStat is the per-problem breakdown of students by derived status. The
// five buckets are mutually exclusive, so accepted+appealed+rejected+submitted+
// unsolved == total_students for every problem.
type problemStat struct {
	ProblemID      int64  `json:"problem_id"`
	ProblemNumber  int    `json:"problem_number"`
	ProblemDisplay string `json:"problem_display"`
	Accepted       int    `json:"accepted"`
	Appealed       int    `json:"appealed"`
	Rejected       int    `json:"rejected"`
	Submitted      int    `json:"submitted"`
	Unsolved       int    `json:"unsolved"`
}

// problemStatsResponse is the series-page teacher summary: the roster size plus
// one breakdown per problem, ordered by problem number.
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

// aggregateProblemStats folds the flat (student × subproblem) rows into per-
// problem bucket counts plus the distinct student total.
//
// Each input row carries one subproblem's status for one student. We first
// reduce a student's subproblem statuses for a problem into a single
// per-(student,problem) status by this precedence (highest first):
//
//  1. accepted  — ALL of the problem's subproblems are accepted
//  2. appealed  — else ANY subproblem is appealed
//  3. rejected  — else ANY subproblem is rejected
//  4. submitted — else ANY subproblem is submitted
//  5. unsolved  — none of the above (every subproblem is ungraded)
//
// Then we count students per (problem, derived status). Every student of the
// center appears for every problem (the SQL crosses roster × subproblems), so
// the five buckets per problem always sum to the distinct student count.
func aggregateProblemStats(rows []store.SeriesProblemStatsRow) (totalStudents int, problems []problemStat) {
	// Accumulated flags for one (student, problem) pair as we scan its rows.
	type acc struct {
		allAccepted  bool
		anyAppealed  bool
		anyRejected  bool
		anySubmitted bool
	}

	type problemKey = int64

	// Per problem: ordered appearance + the running per-student accumulator.
	type problemAgg struct {
		stat problemStat
		// keyed by student_user_id, reset is unnecessary because each student
		// appears under a problem exactly once (all its subproblem rows).
		perStudent map[int64]*acc
	}

	order := make([]problemKey, 0)
	byProblem := make(map[problemKey]*problemAgg)
	students := make(map[int64]struct{})

	for _, row := range rows {
		students[row.StudentUserID] = struct{}{}

		pa, ok := byProblem[row.ProblemID]
		if !ok {
			pa = &problemAgg{
				stat: problemStat{
					ProblemID:      row.ProblemID,
					ProblemNumber:  int(row.ProblemNumber),
					ProblemDisplay: mc.ProblemDisplayName(int(row.ProblemNumber)),
				},
				perStudent: make(map[int64]*acc),
			}
			byProblem[row.ProblemID] = pa
			order = append(order, row.ProblemID)
		}

		a, ok := pa.perStudent[row.StudentUserID]
		if !ok {
			a = &acc{allAccepted: true}
			pa.perStudent[row.StudentUserID] = a
		}
		switch row.CurrentStatus {
		case hw.StatusAccepted:
			// allAccepted stays true unless contradicted by another subproblem.
		case hw.StatusAppealed:
			a.anyAppealed = true
			a.allAccepted = false
		case hw.StatusRejected:
			a.anyRejected = true
			a.allAccepted = false
		case hw.StatusSubmitted:
			a.anySubmitted = true
			a.allAccepted = false
		default: // ungraded (or any unknown status) — not accepted
			a.allAccepted = false
		}
	}

	// Resolve each student's per-problem status by precedence and tally it.
	for _, pid := range order {
		pa := byProblem[pid]
		for _, a := range pa.perStudent {
			switch {
			case a.allAccepted:
				pa.stat.Accepted++
			case a.anyAppealed:
				pa.stat.Appealed++
			case a.anyRejected:
				pa.stat.Rejected++
			case a.anySubmitted:
				pa.stat.Submitted++
			default:
				pa.stat.Unsolved++
			}
		}
		problems = append(problems, pa.stat)
	}
	if problems == nil {
		problems = []problemStat{}
	}
	return len(students), problems
}
