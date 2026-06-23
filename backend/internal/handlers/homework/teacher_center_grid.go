package homework

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// centerGridResponse is the everything-at-once shape the teacher
// spreadsheet renders from: groups (with their student rosters), the list
// of every series for the center (each with its own ordered columns),
// and a single flat cell map keyed by "<studentID>:<subproblemID>". The
// frontend looks up each cell via that key as it iterates rows × columns,
// which avoids any cross-product duplication of cells in the payload.
type centerGridResponse struct {
	Groups []centerGridGroup         `json:"groups"`
	Series []centerGridSeries        `json:"series"`
	Cells  map[string]centerGridCell `json:"cells"`
	// Graders maps a grader's user id to their initials (first letter of the
	// first name + first letter of the last name), for the «Кондуит» view that
	// shows who accepted each problem.
	Graders map[int64]string `json:"graders"`
}

type centerGridGroup struct {
	GroupID  int64                    `json:"group_id"`
	Name     string                   `json:"name"`
	Students []centerGridStudentEntry `json:"students"`
}

type centerGridStudentEntry struct {
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
	// HasStudentComment marks the student when at least one internal teacher
	// note is attached to them.
	HasStudentComment bool `json:"has_student_comment"`
}

type centerGridSeries struct {
	SeriesID    int64              `json:"series_id"`
	Number      int                `json:"number"`
	Name        string             `json:"name"`
	DisplayName string             `json:"display_name"`
	DueAt       time.Time          `json:"due_at"`
	Columns     []centerGridColumn `json:"columns"`
}

type centerGridColumn struct {
	SubproblemID    int64  `json:"subproblem_id"`
	SubproblemLabel string `json:"subproblem_label"`
	ProblemID       int64  `json:"problem_id"`
	ProblemNumber   int    `json:"problem_number"`
	// Short label rendered as the column header in the spreadsheet:
	// "Упр" for problem 0 with no subparts, "Упр а" for problem 0 with
	// subparts, "1" / "2a" / "5b" otherwise. Computed server-side so the
	// frontend doesn't need a duplicate of the label rules.
	ColumnLabel      string     `json:"column_label"`
	IsCoffin         bool       `json:"is_coffin"`
	CoffinReleasedAt *time.Time `json:"coffin_released_at,omitempty"`
}

type centerGridCell struct {
	ThreadID          int64      `json:"thread_id"`
	CurrentStatus     string     `json:"current_status"`
	LastGraderUserID  *int64     `json:"last_grader_user_id,omitempty"`
	ClaimHolderUserID *int64     `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time `json:"claim_expires_at,omitempty"`
	// HasInternalComment marks the cell when its thread carries at least one
	// internal teacher note.
	HasInternalComment bool `json:"has_internal_comment"`
}

// GetCenterGrid — teacher of the center. Returns the matrix used by the
// spreadsheet view that spans every series in the center. The frontend
// renders all series side-by-side and scrolls horizontally so the current
// series stays in view, with grouping by math_center_group on the row axis.
func GetCenterGrid(database *db.DB) http.HandlerFunc {
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

		rows, err := q.TeacherCenterGrid(ctx, centerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Empty center is a valid state — no students or no
				// series yet. Return an empty shape so the frontend can
				// render its "ничего нет" placeholder.
				httpx.WriteJSON(w, http.StatusOK, centerGridResponse{
					Cells:   map[string]centerGridCell{},
					Graders: map[int64]string{},
				})
				return
			}
			logger.LogErrorContext(ctx, "homework: center grid", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		httpx.WriteJSON(w, http.StatusOK, buildCenterGridResponse(rows))
	}
}

// buildCenterGridResponse pivots the flat SQL rows into the three-axis
// (groups, series, cells) shape the frontend expects. Insertion order is
// preserved via the slices in groupBuilder / seriesBuilder; the SQL
// already orders rows the right way.
func buildCenterGridResponse(rows []store.TeacherCenterGridRow) centerGridResponse {
	groups := newGroupBuilder()
	series := newSeriesBuilder()
	cells := make(map[string]centerGridCell, len(rows))
	graders := make(map[int64]string)

	for _, row := range rows {
		groups.add(row)
		series.add(row)
		// Only emit a cell entry when the (student, subproblem) actually
		// has a thread — absent keys default to "ungraded with no
		// thread" on the frontend, saving us one entry per cell in the
		// payload.
		if row.ThreadID == 0 {
			continue
		}
		if row.LastGraderUserID != nil {
			if _, ok := graders[*row.LastGraderUserID]; !ok {
				graders[*row.LastGraderUserID] = initials(row.GraderFirstName, row.GraderLastName)
			}
		}
		key := cellKey(row.StudentUserID, row.SubproblemID)
		cells[key] = centerGridCell{
			ThreadID:           row.ThreadID,
			CurrentStatus:      row.CurrentStatus,
			LastGraderUserID:   row.LastGraderUserID,
			ClaimHolderUserID:  row.ClaimHolderUserID,
			ClaimExpiresAt:     row.ClaimExpiresAt,
			HasInternalComment: row.HasInternalComment,
		}
	}
	return centerGridResponse{
		Groups:  groups.build(),
		Series:  series.build(),
		Cells:   cells,
		Graders: graders,
	}
}

// initials builds a grader's initials: the first letter of the first name plus
// the first letter of the last name (Cyrillic-safe via runes). Either part may
// be missing.
func initials(first, last *string) string {
	out := firstRune(first) + firstRune(last)
	if out == "" {
		return "?"
	}
	return out
}

func firstRune(s *string) string {
	if s == nil {
		return ""
	}
	for _, r := range strings.TrimSpace(*s) {
		return string(r)
	}
	return ""
}

func cellKey(studentUserID, subproblemID int64) string {
	return strconv.FormatInt(studentUserID, 10) + ":" + strconv.FormatInt(subproblemID, 10)
}

// columnLabel renders the short header for a spreadsheet column. The user-
// facing convention: problem 0 reads "Упр" (exercise / Упражнение); other
// problems show their number. When a subpart letter exists, it's appended
// directly ("2a", "Упр а").
func columnLabel(problemNumber int, subproblemLabel string) string {
	var base string
	if problemNumber == 0 {
		base = "Упр"
	} else {
		base = strconv.Itoa(problemNumber)
	}
	sub := strings.TrimSpace(subproblemLabel)
	if sub == "" {
		return base
	}
	// Insert a thin space between the exercise word and the letter so
	// "Упр а" reads better than "Упра". Numbered problems keep the
	// letter glued on ("2a") because that's the conventional notation.
	if problemNumber == 0 {
		return base + " " + sub
	}
	return base + sub
}

// groupBuilder accumulates groups in first-seen order with deduped students.
type groupBuilder struct {
	byID       map[int64]int
	out        []centerGridGroup
	stuByGroup map[int64]map[int64]bool
}

func newGroupBuilder() *groupBuilder {
	return &groupBuilder{
		byID:       make(map[int64]int),
		stuByGroup: make(map[int64]map[int64]bool),
	}
}

func (b *groupBuilder) add(r store.TeacherCenterGridRow) {
	gIdx, ok := b.byID[r.GroupID]
	if !ok {
		b.out = append(b.out, centerGridGroup{GroupID: r.GroupID, Name: r.GroupName})
		gIdx = len(b.out) - 1
		b.byID[r.GroupID] = gIdx
		b.stuByGroup[r.GroupID] = make(map[int64]bool)
	}
	if !b.stuByGroup[r.GroupID][r.StudentUserID] {
		b.stuByGroup[r.GroupID][r.StudentUserID] = true
		b.out[gIdx].Students = append(b.out[gIdx].Students, centerGridStudentEntry{
			UserID:            r.StudentUserID,
			Name:              mc.StudentDisplayName(r.StudentFirstName, r.StudentLastName),
			HasStudentComment: r.HasStudentComment,
		})
	}
}

func (b *groupBuilder) build() []centerGridGroup {
	if b.out == nil {
		return []centerGridGroup{}
	}
	return b.out
}

// seriesBuilder accumulates series in first-seen order with deduped columns.
type seriesBuilder struct {
	byID         map[int64]int
	out          []centerGridSeries
	colsBySeries map[int64]map[int64]bool
}

func newSeriesBuilder() *seriesBuilder {
	return &seriesBuilder{
		byID:         make(map[int64]int),
		colsBySeries: make(map[int64]map[int64]bool),
	}
}

func (b *seriesBuilder) add(r store.TeacherCenterGridRow) {
	sIdx, ok := b.byID[r.SeriesID]
	if !ok {
		b.out = append(b.out, centerGridSeries{
			SeriesID:    r.SeriesID,
			Number:      int(r.SeriesNumber),
			Name:        r.SeriesName,
			DisplayName: mc.SeriesDisplayName(int(r.SeriesNumber), r.SeriesName),
			DueAt:       r.SeriesDueAt,
		})
		sIdx = len(b.out) - 1
		b.byID[r.SeriesID] = sIdx
		b.colsBySeries[r.SeriesID] = make(map[int64]bool)
	}
	if !b.colsBySeries[r.SeriesID][r.SubproblemID] {
		b.colsBySeries[r.SeriesID][r.SubproblemID] = true
		b.out[sIdx].Columns = append(b.out[sIdx].Columns, centerGridColumn{
			SubproblemID:     r.SubproblemID,
			SubproblemLabel:  r.SubproblemLabel,
			ProblemID:        r.ProblemID,
			ProblemNumber:    int(r.ProblemNumber),
			ColumnLabel:      columnLabel(int(r.ProblemNumber), r.SubproblemLabel),
			IsCoffin:         r.IsCoffin,
			CoffinReleasedAt: r.CoffinReleasedAt,
		})
	}
}

func (b *seriesBuilder) build() []centerGridSeries {
	if b.out == nil {
		return []centerGridSeries{}
	}
	return b.out
}
