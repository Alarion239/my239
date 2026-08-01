package homework

import (
	"context"
	"errors"
	"fmt"
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
	// "У" for problem 0 with no subparts, "Уa" for problem 0 with
	// subparts, "1" / "2a" / "5b" otherwise. Computed server-side so the
	// frontend doesn't need a duplicate of the label rules.
	ColumnLabel      string     `json:"column_label"`
	IsCoffin         bool       `json:"is_coffin"`
	CoffinReleasedAt *time.Time `json:"coffin_released_at,omitempty"`
}

type centerGridCell struct {
	ThreadID         int64  `json:"thread_id"`
	CurrentStatus    string `json:"current_status"`
	LastGraderUserID *int64 `json:"last_grader_user_id,omitempty"`
	// LastGraderName is the credited grader of an offline accept. Set when an
	// unregistered grader (no user id) accepted in person, so the conduit can
	// still render their initials; empty for online grades.
	LastGraderName    string     `json:"last_grader_name,omitempty"`
	ClaimHolderUserID *int64     `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time `json:"claim_expires_at,omitempty"`
	// HasInternalComment marks the cell when its thread carries at least one
	// internal teacher note.
	HasInternalComment bool `json:"has_internal_comment,omitempty"`
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

		termID, err := resolveCenterGridTerm(ctx, q, centerID, r.URL.Query().Get("term_id"))
		if err != nil {
			if errors.Is(err, errInvalidCenterGridTerm) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term id")
				return
			}
			logger.LogErrorContext(ctx, "homework: center grid term", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		if termID == 0 {
			httpx.WriteJSON(w, http.StatusOK, emptyCenterGridResponse())
			return
		}

		started := time.Now()
		response, timings, err := loadCenterGridSnapshot(ctx, database.Pool(), centerID, termID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: center grid", err,
				"center_id", centerID,
				"term_id", termID,
			)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		logger.LogInfoContext(ctx, "homework: center grid snapshot",
			"center_id", centerID,
			"term_id", termID,
			"roster_rows", timings.rosterRows,
			"column_rows", timings.columnRows,
			"cell_rows", timings.cellRows,
			"roster_ms", timings.roster.Milliseconds(),
			"columns_ms", timings.columns.Milliseconds(),
			"cells_ms", timings.cells.Milliseconds(),
			"assembly_ms", timings.assembly.Milliseconds(),
			"total_ms", time.Since(started).Milliseconds(),
			"status", http.StatusOK,
		)
		httpx.WriteJSON(w, http.StatusOK, response)
	}
}

// GetCenterGridSeriesCells returns only the mutable cell state for one series.
// It is used by the SSE refresh path so a grading event never refetches the
// entire center-wide grid.
func GetCenterGridSeriesCells(database *db.DB) http.HandlerFunc {
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
		seriesID, err := pathInt64(r, "seriesID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid series id")
			return
		}

		q := store.New(database.Pool())
		if !requireTeacher(ctx, w, r, q, userID, centerID) {
			return
		}
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: center grid series lookup", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if series.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return
		}

		rows, err := q.TeacherCenterGridCellsForSeries(ctx, store.TeacherCenterGridSeriesCellsParams{
			MathCenterID: centerID,
			SeriesID:     seriesID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: center grid series cells", err,
				"center_id", centerID,
				"series_id", seriesID,
			)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		cells, graders := buildCenterGridCells(rows)
		httpx.WriteJSON(w, http.StatusOK, centerGridSeriesCellsResponse{
			SeriesID: seriesID,
			Cells:    cells,
			Graders:  graders,
		})
	}
}

type centerGridSeriesCellsResponse struct {
	SeriesID int64                     `json:"series_id"`
	Cells    map[string]centerGridCell `json:"cells"`
	Graders  map[int64]string          `json:"graders"`
}

var errInvalidCenterGridTerm = errors.New("invalid term id")

type centerGridSnapshotTimings struct {
	rosterRows int
	columnRows int
	cellRows   int
	roster     time.Duration
	columns    time.Duration
	cells      time.Duration
	assembly   time.Duration
}

func resolveCenterGridTerm(ctx context.Context, q *store.Queries, centerID int64, termParam string) (int64, error) {
	if termParam != "" {
		termID, err := strconv.ParseInt(termParam, 10, 64)
		if err != nil || termID <= 0 {
			return 0, errInvalidCenterGridTerm
		}
		return termID, nil
	}

	active, err := q.GetActiveTermForCenter(ctx, centerID)
	if err == nil {
		return active.ID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("resolve active term: %w", err)
	}
	legacy, err := q.GetLegacyTermForCenter(ctx, centerID)
	if err == nil {
		return legacy.ID, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return 0, fmt.Errorf("resolve legacy term: %w", err)
}

func loadCenterGridSnapshot(ctx context.Context, pool db.Pool, centerID, termID int64) (centerGridResponse, centerGridSnapshotTimings, error) {
	var timings centerGridSnapshotTimings
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return centerGridResponse{}, timings, fmt.Errorf("begin center grid snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := store.New(tx)
	args := store.CenterGridTermParams{MathCenterID: centerID, TermID: termID}

	started := time.Now()
	roster, err := q.TeacherCenterGridRosterForTerm(ctx, args)
	timings.roster = time.Since(started)
	if err != nil {
		return centerGridResponse{}, timings, fmt.Errorf("query center grid roster: %w", err)
	}
	timings.rosterRows = len(roster)

	started = time.Now()
	columns, err := q.TeacherCenterGridColumnsForTerm(ctx, args)
	timings.columns = time.Since(started)
	if err != nil {
		return centerGridResponse{}, timings, fmt.Errorf("query center grid columns: %w", err)
	}
	timings.columnRows = len(columns)

	started = time.Now()
	cells, err := q.TeacherCenterGridCellsForTerm(ctx, args)
	timings.cells = time.Since(started)
	if err != nil {
		return centerGridResponse{}, timings, fmt.Errorf("query center grid cells: %w", err)
	}
	timings.cellRows = len(cells)

	started = time.Now()
	response := buildCenterGridResponse(roster, columns, cells)
	timings.assembly = time.Since(started)

	if err := tx.Commit(ctx); err != nil {
		return centerGridResponse{}, timings, fmt.Errorf("commit center grid snapshot: %w", err)
	}
	return response, timings, nil
}

func emptyCenterGridResponse() centerGridResponse {
	return centerGridResponse{
		Groups:  []centerGridGroup{},
		Series:  []centerGridSeries{},
		Cells:   map[string]centerGridCell{},
		Graders: map[int64]string{},
	}
}

// buildCenterGridResponse assembles independent roster, column and cell rows
// into the existing three-axis response. Empty cells are intentionally absent.
func buildCenterGridResponse(roster []store.TeacherCenterGridRosterRow, columns []store.TeacherCenterGridColumnRow, cellRows []store.TeacherCenterGridCellRow) centerGridResponse {
	groups := newGroupBuilder()
	series := newSeriesBuilder()
	for _, row := range roster {
		groups.add(row)
	}
	for _, row := range columns {
		series.add(row)
	}
	cells, graders := buildCenterGridCells(cellRows)
	return centerGridResponse{
		Groups:  groups.build(),
		Series:  series.build(),
		Cells:   cells,
		Graders: graders,
	}
}

func buildCenterGridCells(rows []store.TeacherCenterGridCellRow) (map[string]centerGridCell, map[int64]string) {
	cells := make(map[string]centerGridCell, len(rows))
	graders := make(map[int64]string)
	for _, row := range rows {
		if row.LastGraderUserID != nil {
			if _, ok := graders[*row.LastGraderUserID]; !ok {
				graders[*row.LastGraderUserID] = initials(row.GraderFirstName, row.GraderLastName)
			}
		}
		cells[cellKey(row.StudentUserID, row.SubproblemID)] = centerGridCell{
			ThreadID:           row.ThreadID,
			CurrentStatus:      row.CurrentStatus,
			LastGraderUserID:   row.LastGraderUserID,
			LastGraderName:     row.LastGraderName,
			ClaimHolderUserID:  row.ClaimHolderUserID,
			ClaimExpiresAt:     row.ClaimExpiresAt,
			HasInternalComment: row.HasInternalComment,
		}
	}
	return cells, graders
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
// facing convention: problem 0 reads "У" (exercise / Упражнение); other
// problems show their number. When a subpart letter exists, it's appended
// directly ("2a", "Уa").
func columnLabel(problemNumber int, subproblemLabel string) string {
	var base string
	if problemNumber == 0 {
		base = "У"
	} else {
		base = strconv.Itoa(problemNumber)
	}
	sub := strings.TrimSpace(subproblemLabel)
	if sub == "" {
		return base
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

func (b *groupBuilder) add(r store.TeacherCenterGridRosterRow) {
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

func (b *seriesBuilder) add(r store.TeacherCenterGridColumnRow) {
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
