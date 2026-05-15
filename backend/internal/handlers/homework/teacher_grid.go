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

// gridStudent is one row in the teacher spreadsheet — a student of the
// series's math center plus a flat list of their cells across every
// subproblem in the series.
type gridStudent struct {
	StudentUserID int64      `json:"student_user_id"`
	StudentName   string     `json:"student_name"`
	GroupID       int64      `json:"group_id"`
	GroupName     string     `json:"group_name"`
	Cells         []gridCell `json:"cells"`
}

// gridCell is one (student, subproblem) cell. ThreadID == 0 means no
// thread exists yet (no submission at all); the frontend renders that as a
// neutral "пусто" tile.
type gridCell struct {
	SubproblemID      int64      `json:"subproblem_id"`
	SubproblemLabel   string     `json:"subproblem_label"`
	ProblemID         int64      `json:"problem_id"`
	ProblemNumber     int        `json:"problem_number"`
	ThreadID          int64      `json:"thread_id"`
	CurrentStatus     string     `json:"current_status"`
	LastGraderUserID  *int64     `json:"last_grader_user_id,omitempty"`
	ClaimHolderUserID *int64     `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time `json:"claim_expires_at,omitempty"`
}

// gridSubproblemHeader is a column descriptor sent once at the top of the
// response so the frontend can render problem-grouped column headers
// without inferring them from row data.
type gridSubproblemHeader struct {
	SubproblemID    int64  `json:"subproblem_id"`
	SubproblemLabel string `json:"subproblem_label"`
	ProblemID       int64  `json:"problem_id"`
	ProblemNumber   int    `json:"problem_number"`
	ProblemDisplay  string `json:"problem_display"`
}

// gridResponse pairs the column headers with the student rows. Rows are
// ordered by group → last_name → first_name; cells within each row follow
// the same subproblem order as headers.
type gridResponse struct {
	Columns  []gridSubproblemHeader `json:"columns"`
	Students []gridStudent          `json:"students"`
}

// TeacherGrid — teacher of the series's center. Returns the full
// spreadsheet matrix in one round-trip: every student × every subproblem,
// with thread state filled in or 'ungraded' where no thread exists yet.
//
// Backend computes the cartesian view (cheap for typical class sizes) so
// the frontend can render the table without combining /queue with the
// list of students.
func TeacherGrid(database *db.DB) http.HandlerFunc {
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
			logger.LogError("homework: get series for grid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		rows, err := q.TeacherSeriesGrid(ctx, seriesID)
		if err != nil {
			logger.LogError("homework: teacher grid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// Build the column header set once (subproblems appear identically
		// for every student, so the first student's column ordering is
		// authoritative; using a map handles the empty-grid case).
		columns := buildGridColumns(rows)

		// Bucket rows by student preserving first-seen order, which matches
		// the SQL ORDER BY (group → last → first).
		students := buildGridStudents(rows, columns)

		httpx.WriteJSON(w, http.StatusOK, gridResponse{Columns: columns, Students: students})
	}
}

func buildGridColumns(rows []store.TeacherSeriesGridRow) []gridSubproblemHeader {
	seen := make(map[int64]bool)
	cols := make([]gridSubproblemHeader, 0)
	for _, row := range rows {
		if seen[row.SubproblemID] {
			continue
		}
		seen[row.SubproblemID] = true
		cols = append(cols, gridSubproblemHeader{
			SubproblemID:    row.SubproblemID,
			SubproblemLabel: row.SubproblemLabel,
			ProblemID:       row.ProblemID,
			ProblemNumber:   int(row.ProblemNumber),
			ProblemDisplay:  mc.ProblemDisplayName(int(row.ProblemNumber)),
		})
	}
	return cols
}

func buildGridStudents(rows []store.TeacherSeriesGridRow, columns []gridSubproblemHeader) []gridStudent {
	// Pre-allocate an empty cell slot per column for every student so the
	// final shape is rectangular (frontend can index by column position).
	colIndex := make(map[int64]int, len(columns))
	for i, c := range columns {
		colIndex[c.SubproblemID] = i
	}

	studentIndex := make(map[int64]int)
	out := make([]gridStudent, 0)
	for _, row := range rows {
		idx, ok := studentIndex[row.StudentUserID]
		if !ok {
			out = append(out, gridStudent{
				StudentUserID: row.StudentUserID,
				StudentName:   mc.StudentDisplayName(row.StudentFirstName, row.StudentLastName),
				GroupID:       row.GroupID,
				GroupName:     row.GroupName,
				Cells:         make([]gridCell, len(columns)),
			})
			idx = len(out) - 1
			studentIndex[row.StudentUserID] = idx
		}
		col, ok := colIndex[row.SubproblemID]
		if !ok {
			continue
		}
		threadID := row.ThreadID
		out[idx].Cells[col] = gridCell{
			SubproblemID:      row.SubproblemID,
			SubproblemLabel:   row.SubproblemLabel,
			ProblemID:         row.ProblemID,
			ProblemNumber:     int(row.ProblemNumber),
			ThreadID:          threadID,
			CurrentStatus:     row.CurrentStatus,
			LastGraderUserID:  row.LastGraderUserID,
			ClaimHolderUserID: row.ClaimHolderUserID,
			ClaimExpiresAt:    row.ClaimExpiresAt,
		}
	}
	return out
}
