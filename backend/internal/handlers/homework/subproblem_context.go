package homework

import (
	"errors"
	"net/http"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

// subproblemContextResponse is the minimal metadata the frontend needs to
// render the "first-time submission" page (where no thread exists yet):
// what series/center the subproblem belongs to, the problem display name,
// and the deadline that gates the submit button. Reuses the same
// `GetSubproblemContext` query that other handlers already use internally.
type subproblemContextResponse struct {
	SubproblemID      int64      `json:"subproblem_id"`
	SubproblemLabel   string     `json:"subproblem_label"`
	ProblemID         int64      `json:"problem_id"`
	ProblemNumber     int        `json:"problem_number"`
	ProblemDisplay    string     `json:"problem_display"`
	SeriesID          int64      `json:"series_id"`
	MathCenterID      int64      `json:"math_center_id"`
	SeriesDueAt       time.Time  `json:"series_due_at"`
	SeriesPublishedAt *time.Time `json:"series_published_at,omitempty"`
}

// GetSubproblemContextHandler — any teacher OR student of the center can
// read. We auth-gate to avoid leaking series structure to unrelated users;
// the metadata itself is low-sensitivity (it's already visible via the
// /mathcenter/series endpoints) but keeping the auth model consistent
// across homework endpoints makes the rules easier to reason about.
func GetSubproblemContextHandler(database *db.DB) http.HandlerFunc {
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

		// Either-role check: every center membership type can read this.
		isTeacher, isStudent, err := membership(ctx, q, userID, spCtx.MathCenterID)
		if err != nil {
			logger.LogError("homework: subproblem ctx membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent && !callerIsAdmin(r) {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this subproblem")
			return
		}

		httpx.WriteJSON(w, http.StatusOK, subproblemContextResponse{
			SubproblemID:      spCtx.SubproblemID,
			SubproblemLabel:   spCtx.SubproblemLabel,
			ProblemID:         spCtx.ProblemID,
			ProblemNumber:     int(spCtx.ProblemNumber),
			ProblemDisplay:    mc.ProblemDisplayName(int(spCtx.ProblemNumber)),
			SeriesID:          spCtx.SeriesID,
			MathCenterID:      spCtx.MathCenterID,
			SeriesDueAt:       spCtx.SeriesDueAt,
			SeriesPublishedAt: spCtx.SeriesPublishedAt,
		})
	}
}

// membership is a tiny helper used by the subproblem-context handler. The
// existing handler helpers (`requireTeacher`, `requireStudent`) each only
// gate one role; this returns both flags in one call.
func membership(ctx contextLike, q *store.Queries, userID, centerID int64) (teacher, student bool, err error) {
	teacher, err = q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{UserID: userID, MathCenterID: centerID})
	if err != nil {
		return false, false, err
	}
	student, err = q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{UserID: userID, MathCenterID: centerID})
	if err != nil {
		return false, false, err
	}
	return teacher, student, nil
}

// contextLike is the minimal context surface needed by sqlc-generated
// methods. Using an alias keeps this file's signature short while staying
// compatible with context.Context.
type contextLike = interface {
	Deadline() (time.Time, bool)
	Done() <-chan struct{}
	Err() error
	Value(key any) any
}
