package mathcenter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Coffins ("гробы") + per-subproblem официальный «Разбор». The subproblem is the
// atomic unit: each subproblem has its own разбор (TeX/PDF/link) and its own
// release timing. A coffin is a subproblem kept OPEN for submission past the
// series deadline until its разбор is released (released_at). See migration
// 000011 + internal/homework.SubmissionClosed for the submission-window rule.

func subproblemSolutionPDFKey(subproblemID int64) string {
	return fmt.Sprintf("mathcenter/subproblem/%d.solution.pdf", subproblemID)
}

// coffinView is one coffin subproblem (with series/problem labels) for the
// center-wide Гробы tab. The trailing thread fields are populated only for
// student callers (their own status), so they can submit straight from the tab.
type coffinView struct {
	SubproblemID        int64      `json:"subproblem_id"`
	SubproblemLabel     string     `json:"subproblem_label"`
	ProblemID           int64      `json:"problem_id"`
	ProblemNumber       int        `json:"problem_number"`
	Display             string     `json:"display"`
	SeriesID            int64      `json:"series_id"`
	SeriesNumber        int        `json:"series_number"`
	SeriesName          string     `json:"series_name"`
	MathCenterID        int64      `json:"math_center_id"`
	TermID              int64      `json:"term_id"`
	TermKind            string     `json:"term_kind,omitempty"`
	TermGrade           *int32     `json:"term_grade,omitempty"`
	IsCoffin            bool       `json:"is_coffin"`
	ReleasedAt          *time.Time `json:"released_at,omitempty"`
	SolutionPublishedAt *time.Time `json:"solution_published_at,omitempty"`
	HasSolutionTex      bool       `json:"has_solution_tex"`
	HasSolutionPDF      bool       `json:"has_solution_pdf"`
	SolutionLink        *string    `json:"solution_link,omitempty"`
	RazborAccess        bool       `json:"razbor_access"`
	RazborVideoAccess   bool       `json:"razbor_video_access"`
	RazborPDFTexAccess  bool       `json:"razbor_pdf_tex_access"`
	// Teacher-only "solved N of M" stats.
	AcceptedCount int `json:"accepted_count"`
	TotalCount    int `json:"total_count"`
	// Student-only thread status (zero for teachers).
	ThreadID      int64  `json:"thread_id,omitempty"`
	CurrentStatus string `json:"current_status,omitempty"`
	BeingGraded   bool   `json:"being_graded,omitempty"`
}

type coffinRecord struct {
	SubproblemID         int64
	IsCoffin             bool
	ReleasedAt           *time.Time
	SolutionPublishedAt  *time.Time
	SolutionTexSource    *string
	SolutionPdfObjectKey *string
	SolutionLink         *string
	SubproblemLabel      string
	ProblemID            int64
	ProblemNumber        int32
	SeriesID             int64
	SeriesNumber         int32
	SeriesName           string
	MathCenterID         int64
	TermID               int64
	TermKind             string
	TermGrade            *int32
}

// coffinActionView is the lean response for mark/solution actions; the
// client refetches the list/series view for labels.
type coffinActionView struct {
	SubproblemID        int64      `json:"subproblem_id"`
	IsCoffin            bool       `json:"is_coffin"`
	ReleasedAt          *time.Time `json:"released_at,omitempty"`
	SolutionPublishedAt *time.Time `json:"solution_published_at,omitempty"`
	HasSolutionTex      bool       `json:"has_solution_tex"`
	HasSolutionPDF      bool       `json:"has_solution_pdf"`
	SolutionLink        *string    `json:"solution_link,omitempty"`
}

func toCoffinActionView(s store.MathCenterSubproblemSolution) coffinActionView {
	return coffinActionView{
		SubproblemID:        s.SubproblemID,
		IsCoffin:            s.IsCoffin,
		ReleasedAt:          s.ReleasedAt,
		SolutionPublishedAt: s.PublishedAt,
		HasSolutionTex:      s.SolutionTexSource != nil,
		HasSolutionPDF:      s.SolutionPdfObjectKey != nil,
		SolutionLink:        s.SolutionLink,
	}
}

// solutionReleasedToStudent reports whether a non-teacher may see a subproblem's
// разбор (and, for coffins, whether submission has closed): a coffin is released
// once released_at is set and past; a normal subproblem must be explicitly
// published and then waits for the series deadline.
func solutionReleasedToStudent(s store.MathCenterSubproblemSolution, seriesDueAt, now time.Time) bool {
	if s.IsCoffin {
		return s.PublishedAt != nil && s.ReleasedAt != nil && !now.Before(*s.ReleasedAt)
	}
	return s.PublishedAt != nil && !now.Before(seriesDueAt)
}

// ListCenterCoffins — any member of the center. Returns every coffin subproblem
// with series/problem labels for the center-wide Гробы tab.
func ListCenterCoffins(database *db.DB) http.HandlerFunc {
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
		isTeacher, isStudent, err := membership(ctx, r, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}
		accessBySeries := map[int64]razborAccess{}
		if isStudent && !isTeacher {
			accessBySeries, err = studentRazborAccessForCenter(ctx, q, userID, centerID)
			if err != nil {
				logger.LogErrorContext(ctx, "coffins: razbor access", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
		}
		records := []coffinRecord{}
		selected, hasSelectedTerm := store.MathCenterTerm{}, r.URL.Query().Get("term_id") != ""
		if hasSelectedTerm {
			selected, err = selectedTerm(ctx, r, q, centerID)
			if err != nil {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term")
				return
			}
			rows, err := q.ListCenterCoffinsForTerm(ctx, store.ListCenterCoffinsForTermParams{
				MathCenterID:   centerID,
				TermID:         selected.ID,
				IncludeCarried: selected.IsActive,
			})
			if err != nil {
				logger.LogErrorContext(ctx, "coffins: list term", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list coffins")
				return
			}
			for _, row := range rows {
				records = append(records, coffinRecord{
					SubproblemID: row.SubproblemID, IsCoffin: row.IsCoffin, ReleasedAt: row.ReleasedAt, SolutionPublishedAt: row.PublishedAt,
					SolutionTexSource: row.SolutionTexSource, SolutionPdfObjectKey: row.SolutionPdfObjectKey,
					SolutionLink: row.SolutionLink, SubproblemLabel: row.SubproblemLabel, ProblemID: row.ProblemID,
					ProblemNumber: row.ProblemNumber, SeriesID: row.SeriesID, SeriesNumber: row.SeriesNumber,
					SeriesName: row.SeriesName, MathCenterID: row.MathCenterID, TermID: row.TermID,
					TermKind: row.TermKind, TermGrade: row.TermGrade,
				})
			}
		} else {
			rows, err := q.ListCenterCoffins(ctx, centerID)
			if err != nil {
				logger.LogErrorContext(ctx, "coffins: list", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list coffins")
				return
			}
			for _, row := range rows {
				records = append(records, coffinRecord{
					SubproblemID: row.SubproblemID, IsCoffin: row.IsCoffin, ReleasedAt: row.ReleasedAt, SolutionPublishedAt: row.PublishedAt,
					SolutionTexSource: row.SolutionTexSource, SolutionPdfObjectKey: row.SolutionPdfObjectKey,
					SolutionLink: row.SolutionLink, SubproblemLabel: row.SubproblemLabel, ProblemID: row.ProblemID,
					ProblemNumber: row.ProblemNumber, SeriesID: row.SeriesID, SeriesNumber: row.SeriesNumber,
					SeriesName: row.SeriesName, MathCenterID: row.MathCenterID,
				})
			}
		}

		// Students get their own thread status per coffin subproblem so they can
		// submit from the tab. Teachers manage + grade elsewhere.
		statusBySub := map[int64]store.ListCoffinSubproblemsForStudentRow{}
		if isStudent && !isTeacher {
			spRows, err := q.ListCoffinSubproblemsForStudent(ctx, store.ListCoffinSubproblemsForStudentParams{
				MathCenterID: centerID, StudentUserID: userID,
			})
			if err != nil {
				logger.LogErrorContext(ctx, "coffins: subproblems", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
			for _, sp := range spRows {
				statusBySub[sp.SubproblemID] = sp
			}
		}

		// Teachers get per-coffin "solved N of M" stats.
		statsBySub := map[int64]store.ListCoffinSolvedCountsRow{}
		if isTeacher {
			counts, err := q.ListCoffinSolvedCounts(ctx, centerID)
			if err != nil {
				logger.LogErrorContext(ctx, "coffins: solved counts", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
			for _, c := range counts {
				statsBySub[c.SubproblemID] = c
			}
		}

		out := make([]coffinView, 0, len(records))
		for _, c := range records {
			access := razborAccess{Video: true, PDFTex: true}
			if isStudent && !isTeacher {
				if c.IsCoffin {
					released := c.SolutionPublishedAt != nil && c.ReleasedAt != nil && !time.Now().Before(*c.ReleasedAt)
					access = razborAccess{Video: released, PDFTex: released}
				} else {
					access = accessBySeries[c.SeriesID]
				}
			}
			display := mc.SubproblemDisplayName(int(c.ProblemNumber), c.SubproblemLabel)
			if hasSelectedTerm && (!selected.IsActive || c.TermID != selected.ID) {
				display = fmt.Sprintf("%s.%d.%d%s", mc.TermReferencePrefix(c.TermKind, c.TermGrade), c.SeriesNumber, c.ProblemNumber, c.SubproblemLabel)
			}
			teacherVisible := isTeacher || c.SolutionPublishedAt != nil
			v := coffinView{
				SubproblemID:        c.SubproblemID,
				SubproblemLabel:     c.SubproblemLabel,
				ProblemID:           c.ProblemID,
				ProblemNumber:       int(c.ProblemNumber),
				Display:             display,
				SeriesID:            c.SeriesID,
				SeriesNumber:        int(c.SeriesNumber),
				SeriesName:          c.SeriesName,
				MathCenterID:        c.MathCenterID,
				TermID:              c.TermID,
				TermKind:            c.TermKind,
				TermGrade:           c.TermGrade,
				IsCoffin:            c.IsCoffin,
				ReleasedAt:          c.ReleasedAt,
				SolutionPublishedAt: c.SolutionPublishedAt,
				HasSolutionTex:      access.PDFTex && teacherVisible && c.SolutionTexSource != nil,
				HasSolutionPDF:      access.PDFTex && teacherVisible && c.SolutionPdfObjectKey != nil,
				RazborAccess:        access.Video || access.PDFTex,
				RazborVideoAccess:   access.Video,
				RazborPDFTexAccess:  access.PDFTex,
			}
			if access.Video && teacherVisible {
				v.SolutionLink = c.SolutionLink
			}
			if st, ok := statusBySub[c.SubproblemID]; ok {
				v.ThreadID = st.ThreadID
				v.CurrentStatus = st.CurrentStatus
				v.BeingGraded = st.BeingGraded
			}
			if cs, ok := statsBySub[c.SubproblemID]; ok {
				v.AcceptedCount = int(cs.Accepted)
				v.TotalCount = int(cs.Total)
			}
			out = append(out, v)
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// coffinQueueItem is one row of the center-wide coffin grading queue.
type coffinQueueItem struct {
	ThreadID          int64      `json:"thread_id"`
	StudentUserID     int64      `json:"student_user_id"`
	StudentName       string     `json:"student_name"`
	SubproblemID      int64      `json:"subproblem_id"`
	SubproblemLabel   string     `json:"subproblem_label"`
	ProblemNumber     int        `json:"problem_number"`
	ProblemDisplay    string     `json:"problem_display"`
	SeriesID          int64      `json:"series_id"`
	CurrentStatus     string     `json:"current_status"`
	UpdatedAt         time.Time  `json:"updated_at"`
	LastGraderUserID  *int64     `json:"last_grader_user_id,omitempty"`
	ClaimHolderUserID *int64     `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time `json:"claim_expires_at,omitempty"`
	BackgroundHex     *string    `json:"background_hex"`
}

// ListCoffinQueue — teacher of the center. The center-wide coffin grading queue:
// submissions/appeals on coffin subproblems available to grade.
func ListCoffinQueue(database *db.DB) http.HandlerFunc {
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
		rows, err := q.ListCoffinQueueForCenter(ctx, store.ListCoffinQueueForCenterParams{
			MathCenterID: centerID, CallerUserID: userID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: queue", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load coffin queue")
			return
		}
		colors, err := StudentNameColorsForCenter(ctx, q, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: queue student name colors", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		out := make([]coffinQueueItem, 0, len(rows))
		for _, row := range rows {
			var backgroundHex *string
			if color := colors[row.StudentUserID]; color != "" {
				backgroundHex = &color
			}
			out = append(out, coffinQueueItem{
				ThreadID:          row.ThreadID,
				StudentUserID:     row.StudentUserID,
				StudentName:       mc.StudentDisplayName(row.StudentFirstName, row.StudentLastName),
				SubproblemID:      row.SubproblemID,
				SubproblemLabel:   row.SubproblemLabel,
				ProblemNumber:     int(row.ProblemNumber),
				ProblemDisplay:    mc.ProblemDisplayName(int(row.ProblemNumber)),
				SeriesID:          row.SeriesID,
				CurrentStatus:     row.CurrentStatus,
				UpdatedAt:         row.UpdatedAt,
				LastGraderUserID:  row.LastGraderUserID,
				ClaimHolderUserID: row.ClaimHolderUserID,
				ClaimExpiresAt:    row.ClaimExpiresAt,
				BackgroundHex:     backgroundHex,
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// loadSubproblemForWrite resolves a subproblem id, authorizes the caller as a
// teacher of its center, and returns the resolution row (subproblem→center +
// series due_at). Writes 404/403/500 on failure.
func loadSubproblemForWrite(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, subproblemID int64) (store.GetSubproblemSolutionCenterRow, bool) {
	sc, err := q.GetSubproblemSolutionCenter(ctx, subproblemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
			return store.GetSubproblemSolutionCenterRow{}, false
		}
		logger.LogErrorContext(ctx, "coffins: subproblem center", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.GetSubproblemSolutionCenterRow{}, false
	}
	if !requireTeacher(ctx, w, r, q, userID, sc.MathCenterID) {
		return store.GetSubproblemSolutionCenterRow{}, false
	}
	return sc, true
}

// loadSubproblemForRead resolves a subproblem + its solution row and authorizes
// any center member, also reporting whether the caller is a teacher (so reads
// can gate students on release) and the series deadline. Writes 404/403/500.
func loadSubproblemForRead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, subproblemID int64) (store.MathCenterSubproblemSolution, time.Time, bool, razborAccess, bool) {
	sc, err := q.GetSubproblemSolutionCenter(ctx, subproblemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
			return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
		}
		logger.LogErrorContext(ctx, "coffins: subproblem center", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
	}
	isTeacher, isStudent, err := membership(ctx, r, q, userID, sc.MathCenterID)
	if err != nil {
		logger.LogErrorContext(ctx, "coffins: membership", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
	}
	if !isTeacher && !isStudent {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this subproblem")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
	}
	access := razborAccess{Video: true, PDFTex: true}
	if isStudent && !isTeacher {
		accessRow, err := q.GetStudentSeriesRazborAccess(ctx, store.GetStudentSeriesRazborAccessParams{
			UserID: userID,
			ID:     sc.SeriesID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: razbor access", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
		}
		access = razborAccess{Video: accessRow.CanViewVideo, PDFTex: accessRow.CanViewPdfTex}
	}
	s, err := q.GetSubproblemSolutionWithPublication(ctx, subproblemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор uploaded yet")
			return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
		}
		logger.LogErrorContext(ctx, "coffins: get solution", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, razborAccess{}, false
	}
	if s.IsCoffin {
		access = razborAccess{Video: true, PDFTex: true}
	}
	return s, sc.SeriesDueAt, isTeacher, access, true
}

// MarkCoffin — teacher-only. Marks a subproblem as a coffin (idempotent),
// re-opening it for submission past the series deadline.
func MarkCoffin(database *db.DB, hub *live.Hub) http.HandlerFunc {
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
		sc, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		s, err := q.UpsertCoffinFlagWithPublication(ctx, subproblemID, true)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: mark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to mark coffin")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}

// UnmarkCoffin — teacher-only. Clears the coffin flag (the subproblem reverts to
// the normal series deadline). If no разбор remains, the row + its PDF are
// removed; otherwise the разбор is kept.
func UnmarkCoffin(database *db.DB, hub *live.Hub, blobs objectstore.Store) http.HandlerFunc {
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
		sc, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		existing, err := q.GetSubproblemSolution(ctx, subproblemID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			logger.LogErrorContext(ctx, "coffins: get for unmark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if errors.Is(err, pgx.ErrNoRows) {
			// Not a coffin and no разбор — nothing to do.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		hasSolution := existing.SolutionTexSource != nil || existing.SolutionPdfObjectKey != nil || existing.SolutionLink != nil
		if hasSolution {
			// Keep the разбор; just clear the coffin flag.
			if _, err := q.UpsertCoffinFlag(ctx, store.UpsertCoffinFlagParams{SubproblemID: subproblemID, IsCoffin: false}); err != nil {
				logger.LogErrorContext(ctx, "coffins: clear flag", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to unmark coffin")
				return
			}
			live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// No разбор content — drop the row entirely (and any stray PDF).
		if existing.SolutionPdfObjectKey != nil {
			if err := blobs.Delete(ctx, *existing.SolutionPdfObjectKey); err != nil {
				logger.LogErrorContext(ctx, "coffins: delete blob", err)
			}
		}
		if _, err := q.DeleteSubproblemSolution(ctx, subproblemID); err != nil {
			logger.LogErrorContext(ctx, "coffins: unmark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to unmark coffin")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- per-subproblem разбор: TeX ---------------------------------------------

func PutSubproblemSolutionTex(database *db.DB, hub *live.Hub) http.HandlerFunc {
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
		var req texPayload
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if msg := validateTexSource(req.Tex); msg != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, msg)
			return
		}
		q := store.New(database.Pool())
		sc, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		tex := normalizeTexSource(req.Tex)
		s, err := q.SetSubproblemSolutionTexWithPublication(ctx, subproblemID, &tex)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save разбор")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}

func GetSubproblemSolutionTex(database *db.DB) http.HandlerFunc {
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
		s, dueAt, isTeacher, access, ok := loadSubproblemForRead(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		if !isTeacher && !access.PDFTex {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "PDF and LaTeX razbor access is disabled")
			return
		}
		if !isTeacher && !solutionReleasedToStudent(s, dueAt, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if s.SolutionTexSource == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор tex uploaded yet")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, texPayload{Tex: *s.SolutionTexSource})
	}
}

// --- per-subproblem разбор: PDF ---------------------------------------------

func IssueSubproblemSolutionPDFUploadURL(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
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
		if _, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID); !ok {
			return
		}
		presignPDFUpload(ctx, w, r, blobs, subproblemSolutionPDFKey(subproblemID), uploadTTL)
	}
}

func FinalizeSubproblemSolutionPDFPublish(database *db.DB, hub *live.Hub, blobs objectstore.Store) http.HandlerFunc {
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
		var req pdfPublishRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		q := store.New(database.Pool())
		sc, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		key := subproblemSolutionPDFKey(subproblemID)
		if req.ObjectKey != key {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "object_key does not match this subproblem")
			return
		}
		if !statValidatePDF(ctx, w, r, blobs, key) {
			return
		}
		s, err := q.SetSubproblemSolutionPdfWithPublication(ctx, subproblemID, &key)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish разбор")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}

func DownloadSubproblemSolutionPDF(database *db.DB, blobs objectstore.Store, ttl time.Duration) http.HandlerFunc {
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
		s, dueAt, isTeacher, access, ok := loadSubproblemForRead(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		if !isTeacher && !access.PDFTex {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "PDF and LaTeX razbor access is disabled")
			return
		}
		if !isTeacher && !solutionReleasedToStudent(s, dueAt, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if s.SolutionPdfObjectKey == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор pdf uploaded yet")
			return
		}
		redirectToPDF(ctx, w, r, blobs, *s.SolutionPdfObjectKey, ttl)
	}
}

// --- shared разбор groups ---------------------------------------------------

type assignGroupRequest struct {
	SubproblemIDs []int64 `json:"subproblem_ids"`
}

// AssignSolutionGroup — teacher-only. Mints a fresh group id and assigns it to
// every subproblem in the set, recording that they share one разбор (so the
// student Разбор view can group + light up the whole set). Content is set by
// the per-subproblem endpoints first; this just labels the set.
func AssignSolutionGroup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		var req assignGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if len(req.SubproblemIDs) == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "subproblem_ids required")
			return
		}
		q := store.New(database.Pool())
		ids := uniquePositiveIDs(req.SubproblemIDs)
		if len(ids) == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "subproblem_ids required")
			return
		}
		first, err := q.GetSubproblemSolutionCenter(ctx, ids[0])
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
			} else {
				logger.LogErrorContext(ctx, "coffins: group target", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			}
			return
		}
		for _, id := range ids[1:] {
			target, targetErr := q.GetSubproblemSolutionCenter(ctx, id)
			if targetErr != nil {
				if errors.Is(targetErr, pgx.ErrNoRows) {
					httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
				} else {
					logger.LogErrorContext(ctx, "coffins: group target", targetErr)
					httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				}
				return
			}
			if target.MathCenterID != first.MathCenterID || target.SeriesID != first.SeriesID {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "subproblems must belong to one center and series")
				return
			}
		}
		if !requireTeacher(ctx, w, r, q, userID, first.MathCenterID) {
			return
		}
		groupID, err := q.CreateSolutionGroup(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: create solution group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to group разбор")
			return
		}
		if err := q.SetSubproblemSolutionGroup(ctx, store.SetSubproblemSolutionGroupParams{
			GroupID: groupID, SubproblemIds: ids,
		}); err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to group разбор")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]int64{"group_id": groupID})
	}
}

// --- per-subproblem разбор: external link -----------------------------------

func SetSubproblemSolutionLinkHandler(database *db.DB, hub *live.Hub) http.HandlerFunc {
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
		var req solutionLinkPayload
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		link := strings.TrimSpace(req.Link)
		if msg := validateSolutionLink(link); msg != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, msg)
			return
		}
		q := store.New(database.Pool())
		sc, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID)
		if !ok {
			return
		}
		if link == "" {
			if existing, getErr := q.GetSubproblemSolutionWithPublication(ctx, subproblemID); getErr == nil && existing.PublishedAt != nil && existing.SolutionTexSource == nil && existing.SolutionPdfObjectKey == nil {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "a published разбор must retain at least one format")
				return
			} else if getErr != nil && !errors.Is(getErr, pgx.ErrNoRows) {
				logger.LogErrorContext(ctx, "coffins: get solution before link clear", getErr)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
		}
		var linkPtr *string
		if link != "" {
			linkPtr = &link
		}
		s, err := q.SetSubproblemSolutionLinkWithPublication(ctx, subproblemID, linkPtr)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution link", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save link")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: sc.MathCenterID, Kind: live.KindCoffins})
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}
