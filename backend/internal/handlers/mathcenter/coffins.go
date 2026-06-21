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
	SubproblemID    int64      `json:"subproblem_id"`
	SubproblemLabel string     `json:"subproblem_label"`
	ProblemID       int64      `json:"problem_id"`
	ProblemNumber   int        `json:"problem_number"`
	Display         string     `json:"display"`
	SeriesID        int64      `json:"series_id"`
	SeriesNumber    int        `json:"series_number"`
	SeriesName      string     `json:"series_name"`
	MathCenterID    int64      `json:"math_center_id"`
	IsCoffin        bool       `json:"is_coffin"`
	ReleasedAt      *time.Time `json:"released_at,omitempty"`
	HasSolutionTex  bool       `json:"has_solution_tex"`
	HasSolutionPDF  bool       `json:"has_solution_pdf"`
	SolutionLink    *string    `json:"solution_link,omitempty"`
	// Student-only thread status (zero for teachers).
	ThreadID      int64  `json:"thread_id,omitempty"`
	CurrentStatus string `json:"current_status,omitempty"`
	BeingGraded   bool   `json:"being_graded,omitempty"`
}

// coffinActionView is the lean response for mark/release/solution actions; the
// client refetches the list/series view for labels.
type coffinActionView struct {
	SubproblemID   int64      `json:"subproblem_id"`
	IsCoffin       bool       `json:"is_coffin"`
	ReleasedAt     *time.Time `json:"released_at,omitempty"`
	HasSolutionTex bool       `json:"has_solution_tex"`
	HasSolutionPDF bool       `json:"has_solution_pdf"`
	SolutionLink   *string    `json:"solution_link,omitempty"`
}

func toCoffinActionView(s store.MathCenterSubproblemSolution) coffinActionView {
	return coffinActionView{
		SubproblemID:   s.SubproblemID,
		IsCoffin:       s.IsCoffin,
		ReleasedAt:     s.ReleasedAt,
		HasSolutionTex: s.SolutionTexSource != nil,
		HasSolutionPDF: s.SolutionPdfObjectKey != nil,
		SolutionLink:   s.SolutionLink,
	}
}

// solutionReleasedToStudent reports whether a non-teacher may see a subproblem's
// разбор (and, for coffins, whether submission has closed): a coffin is released
// once released_at is set and past; a normal subproblem at the series deadline.
func solutionReleasedToStudent(s store.MathCenterSubproblemSolution, seriesDueAt, now time.Time) bool {
	if s.IsCoffin {
		return s.ReleasedAt != nil && !now.Before(*s.ReleasedAt)
	}
	return !now.Before(seriesDueAt)
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
		rows, err := q.ListCenterCoffins(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: list", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list coffins")
			return
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

		out := make([]coffinView, 0, len(rows))
		for _, c := range rows {
			v := coffinView{
				SubproblemID:    c.SubproblemID,
				SubproblemLabel: c.SubproblemLabel,
				ProblemID:       c.ProblemID,
				ProblemNumber:   int(c.ProblemNumber),
				Display:         mc.SubproblemDisplayName(int(c.ProblemNumber), c.SubproblemLabel),
				SeriesID:        c.SeriesID,
				SeriesNumber:    int(c.SeriesNumber),
				SeriesName:      c.SeriesName,
				MathCenterID:    c.MathCenterID,
				IsCoffin:        c.IsCoffin,
				ReleasedAt:      c.ReleasedAt,
				HasSolutionTex:  c.SolutionTexSource != nil,
				HasSolutionPDF:  c.SolutionPdfObjectKey != nil,
				SolutionLink:    c.SolutionLink,
			}
			if st, ok := statusBySub[c.SubproblemID]; ok {
				v.ThreadID = st.ThreadID
				v.CurrentStatus = st.CurrentStatus
				v.BeingGraded = st.BeingGraded
			}
			out = append(out, v)
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
func loadSubproblemForRead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, subproblemID int64) (store.MathCenterSubproblemSolution, time.Time, bool, bool) {
	sc, err := q.GetSubproblemSolutionCenter(ctx, subproblemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem not found")
			return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
		}
		logger.LogErrorContext(ctx, "coffins: subproblem center", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
	}
	isTeacher, isStudent, err := membership(ctx, r, q, userID, sc.MathCenterID)
	if err != nil {
		logger.LogErrorContext(ctx, "coffins: membership", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
	}
	if !isTeacher && !isStudent {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this subproblem")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
	}
	s, err := q.GetSubproblemSolution(ctx, subproblemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор uploaded yet")
			return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
		}
		logger.LogErrorContext(ctx, "coffins: get solution", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSubproblemSolution{}, time.Time{}, false, false
	}
	return s, sc.SeriesDueAt, isTeacher, true
}

// MarkCoffin — teacher-only. Marks a subproblem as a coffin (idempotent),
// re-opening it for submission past the series deadline.
func MarkCoffin(database *db.DB) http.HandlerFunc {
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
		s, err := q.UpsertCoffinFlag(ctx, store.UpsertCoffinFlagParams{SubproblemID: subproblemID, IsCoffin: true})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: mark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to mark coffin")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}

// UnmarkCoffin — teacher-only. Clears the coffin flag (the subproblem reverts to
// the normal series deadline). If no разбор remains, the row + its PDF are
// removed; otherwise the разбор is kept.
func UnmarkCoffin(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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
		w.WriteHeader(http.StatusNoContent)
	}
}

// ReleaseCoffin — teacher-only. Stamps released_at, closing a coffin's
// submission window and making its разбор available.
func ReleaseCoffin(database *db.DB) http.HandlerFunc {
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
		s, err := q.ReleaseSubproblemSolution(ctx, subproblemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "subproblem is not a coffin")
				return
			}
			logger.LogErrorContext(ctx, "coffins: release", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to release coffin")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}

// --- per-subproblem разбор: TeX ---------------------------------------------

func PutSubproblemSolutionTex(database *db.DB) http.HandlerFunc {
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
		if _, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID); !ok {
			return
		}
		tex := req.Tex
		s, err := q.SetSubproblemSolutionTex(ctx, store.SetSubproblemSolutionTexParams{SubproblemID: subproblemID, SolutionTexSource: &tex})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save разбор")
			return
		}
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
		s, dueAt, isTeacher, ok := loadSubproblemForRead(ctx, w, r, q, userID, subproblemID)
		if !ok {
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

func FinalizeSubproblemSolutionPDFPublish(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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
		if _, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID); !ok {
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
		s, err := q.SetSubproblemSolutionPdf(ctx, store.SetSubproblemSolutionPdfParams{SubproblemID: subproblemID, SolutionPdfObjectKey: &key})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish разбор")
			return
		}
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
		s, dueAt, isTeacher, ok := loadSubproblemForRead(ctx, w, r, q, userID, subproblemID)
		if !ok {
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
		// Authorize via the first subproblem's center (they come from one
		// series, so share a center); the content endpoints already checked each.
		if _, ok := loadSubproblemForWrite(ctx, w, r, q, userID, req.SubproblemIDs[0]); !ok {
			return
		}
		groupID, err := q.CreateSolutionGroup(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: create solution group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to group разбор")
			return
		}
		if err := q.SetSubproblemSolutionGroup(ctx, store.SetSubproblemSolutionGroupParams{
			GroupID: groupID, SubproblemIds: req.SubproblemIDs,
		}); err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to group разбор")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]int64{"group_id": groupID})
	}
}

// --- per-subproblem разбор: external link -----------------------------------

func SetSubproblemSolutionLinkHandler(database *db.DB) http.HandlerFunc {
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
		if _, ok := loadSubproblemForWrite(ctx, w, r, q, userID, subproblemID); !ok {
			return
		}
		var linkPtr *string
		if link != "" {
			linkPtr = &link
		}
		s, err := q.SetSubproblemSolutionLink(ctx, store.SetSubproblemSolutionLinkParams{SubproblemID: subproblemID, SolutionLink: linkPtr})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution link", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save link")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(s))
	}
}
