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

// Coffins ("гробы"): hard problems kept open for submission past the series
// deadline until their own разбор is released. See migration 000010 +
// internal/homework.SubmissionClosed for the submission-window rule.

func coffinSolutionPDFKey(coffinID int64) string {
	return fmt.Sprintf("mathcenter/coffin/%d.pdf", coffinID)
}

// coffinSubproblemView is one subpart of a coffin with the calling student's
// status, so the Гробы tab can show tiles + a "Сдать" shortcut.
type coffinSubproblemView struct {
	SubproblemID    int64  `json:"subproblem_id"`
	SubproblemLabel string `json:"subproblem_label"`
	ThreadID        int64  `json:"thread_id"`
	CurrentStatus   string `json:"current_status"`
	BeingGraded     bool   `json:"being_graded"`
}

// coffinView is the rich list row (with series/problem labels) for the Гробы tab.
// Subproblems is populated only for student callers (their own thread status).
type coffinView struct {
	ID             int64                  `json:"id"`
	ProblemID      int64                  `json:"problem_id"`
	SeriesID       int64                  `json:"series_id"`
	SeriesNumber   int                    `json:"series_number"`
	SeriesName     string                 `json:"series_name"`
	MathCenterID   int64                  `json:"math_center_id"`
	ProblemNumber  int                    `json:"problem_number"`
	ProblemDisplay string                 `json:"problem_display"`
	ReleasedAt     *time.Time             `json:"released_at,omitempty"`
	HasSolutionTex bool                   `json:"has_solution_tex"`
	HasSolutionPDF bool                   `json:"has_solution_pdf"`
	SolutionLink   *string                `json:"solution_link,omitempty"`
	Subproblems    []coffinSubproblemView `json:"subproblems,omitempty"`
}

// coffinActionView is the lean response for mark/release/solution actions; the
// client refetches the list for labels.
type coffinActionView struct {
	ID             int64      `json:"id"`
	ProblemID      int64      `json:"problem_id"`
	ReleasedAt     *time.Time `json:"released_at,omitempty"`
	HasSolutionTex bool       `json:"has_solution_tex"`
	HasSolutionPDF bool       `json:"has_solution_pdf"`
	SolutionLink   *string    `json:"solution_link,omitempty"`
}

func toCoffinActionView(c store.MathCenterCoffin) coffinActionView {
	return coffinActionView{
		ID:             c.ID,
		ProblemID:      c.ProblemID,
		ReleasedAt:     c.ReleasedAt,
		HasSolutionTex: c.SolutionTexSource != nil,
		HasSolutionPDF: c.SolutionPdfObjectKey != nil,
		SolutionLink:   c.SolutionLink,
	}
}

// coffinReleased reports whether a coffin's solution is released (and visible
// to students): released_at set and not in the future.
func coffinReleased(c store.MathCenterCoffin, now time.Time) bool {
	return c.ReleasedAt != nil && !now.Before(*c.ReleasedAt)
}

// ListCenterCoffins — any member of the center. Returns every coffin with
// series/problem labels for the center-wide Гробы tab.
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

		// Students get the per-coffin subproblem grid (their own thread status)
		// so they can submit from the tab. Teachers manage + grade elsewhere.
		subsByCoffin := map[int64][]coffinSubproblemView{}
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
				subsByCoffin[sp.CoffinID] = append(subsByCoffin[sp.CoffinID], coffinSubproblemView{
					SubproblemID:    sp.SubproblemID,
					SubproblemLabel: sp.SubproblemLabel,
					ThreadID:        sp.ThreadID,
					CurrentStatus:   sp.CurrentStatus,
					BeingGraded:     sp.BeingGraded,
				})
			}
		}

		out := make([]coffinView, 0, len(rows))
		for _, c := range rows {
			out = append(out, coffinView{
				ID:             c.ID,
				ProblemID:      c.ProblemID,
				SeriesID:       c.SeriesID,
				SeriesNumber:   int(c.SeriesNumber),
				SeriesName:     c.SeriesName,
				MathCenterID:   c.MathCenterID,
				ProblemNumber:  int(c.ProblemNumber),
				ProblemDisplay: mc.ProblemDisplayName(int(c.ProblemNumber)),
				ReleasedAt:     c.ReleasedAt,
				HasSolutionTex: c.SolutionTexSource != nil,
				HasSolutionPDF: c.SolutionPdfObjectKey != nil,
				SolutionLink:   c.SolutionLink,
				Subproblems:    subsByCoffin[c.ID],
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// MarkCoffin — teacher-only. Marks a problem as a coffin (idempotent),
// re-opening it for submission past the series deadline.
func MarkCoffin(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		problemID, err := pathInt64(r, "problemID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid problem id")
			return
		}
		q := store.New(database.Pool())
		pc, err := q.GetProblemCenter(ctx, problemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "problem not found")
				return
			}
			logger.LogErrorContext(ctx, "coffins: problem center", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, pc.MathCenterID) {
			return
		}
		c, err := q.MarkCoffin(ctx, problemID)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: mark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to mark coffin")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(c))
	}
}

// UnmarkCoffin — teacher-only. Removes the coffin (problem reverts to the
// normal series deadline). Best-effort deletes its разбор PDF.
func UnmarkCoffin(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		problemID, err := pathInt64(r, "problemID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid problem id")
			return
		}
		q := store.New(database.Pool())
		pc, err := q.GetProblemCenter(ctx, problemID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "problem not found")
				return
			}
			logger.LogErrorContext(ctx, "coffins: problem center", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, pc.MathCenterID) {
			return
		}
		if existing, err := q.GetCoffinByProblem(ctx, problemID); err == nil && existing.SolutionPdfObjectKey != nil {
			if err := blobs.Delete(ctx, *existing.SolutionPdfObjectKey); err != nil {
				logger.LogErrorContext(ctx, "coffins: delete blob", err)
			}
		}
		if _, err := q.UnmarkCoffin(ctx, problemID); err != nil {
			logger.LogErrorContext(ctx, "coffins: unmark", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to unmark coffin")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// loadCoffinForWrite resolves a coffin id, authorizes the caller as a teacher of
// its center, and returns the coffin row. Writes 404/403/500 on failure.
func loadCoffinForWrite(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, coffinID int64) (store.MathCenterCoffin, bool) {
	cc, err := q.GetCoffinCenter(ctx, coffinID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "coffin not found")
			return store.MathCenterCoffin{}, false
		}
		logger.LogErrorContext(ctx, "coffins: center", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterCoffin{}, false
	}
	if !requireTeacher(ctx, w, r, q, userID, cc.MathCenterID) {
		return store.MathCenterCoffin{}, false
	}
	c, err := q.GetCoffin(ctx, coffinID)
	if err != nil {
		logger.LogErrorContext(ctx, "coffins: get", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterCoffin{}, false
	}
	return c, true
}

// ReleaseCoffin — teacher-only. Stamps released_at, closing submission and
// making the coffin's разбор available.
func ReleaseCoffin(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
			return
		}
		q := store.New(database.Pool())
		if _, ok := loadCoffinForWrite(ctx, w, r, q, userID, coffinID); !ok {
			return
		}
		c, err := q.ReleaseCoffin(ctx, coffinID)
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: release", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to release coffin")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(c))
	}
}

// --- coffin разбор: TeX ----------------------------------------------------

func PutCoffinSolutionTex(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
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
		if _, ok := loadCoffinForWrite(ctx, w, r, q, userID, coffinID); !ok {
			return
		}
		tex := req.Tex
		c, err := q.SetCoffinSolutionTex(ctx, store.SetCoffinSolutionTexParams{ID: coffinID, SolutionTexSource: &tex})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save разбор")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(c))
	}
}

func GetCoffinSolutionTex(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
			return
		}
		q := store.New(database.Pool())
		c, isTeacher, ok := loadCoffinForRead(ctx, w, r, q, userID, coffinID)
		if !ok {
			return
		}
		if !isTeacher && !coffinReleased(c, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if c.SolutionTexSource == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор tex uploaded yet")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, texPayload{Tex: *c.SolutionTexSource})
	}
}

// loadCoffinForRead resolves a coffin and authorizes any center member, also
// reporting whether the caller is a teacher (so reads can gate студенты on
// release). Writes 404/403/500 on failure.
func loadCoffinForRead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, coffinID int64) (store.MathCenterCoffin, bool, bool) {
	cc, err := q.GetCoffinCenter(ctx, coffinID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "coffin not found")
			return store.MathCenterCoffin{}, false, false
		}
		logger.LogErrorContext(ctx, "coffins: center", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterCoffin{}, false, false
	}
	isTeacher, isStudent, err := membership(ctx, r, q, userID, cc.MathCenterID)
	if err != nil {
		logger.LogErrorContext(ctx, "coffins: membership", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterCoffin{}, false, false
	}
	if !isTeacher && !isStudent {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this coffin")
		return store.MathCenterCoffin{}, false, false
	}
	c, err := q.GetCoffin(ctx, coffinID)
	if err != nil {
		logger.LogErrorContext(ctx, "coffins: get", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterCoffin{}, false, false
	}
	return c, isTeacher, true
}

// --- coffin разбор: PDF ----------------------------------------------------

func IssueCoffinSolutionPDFUploadURL(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
			return
		}
		q := store.New(database.Pool())
		if _, ok := loadCoffinForWrite(ctx, w, r, q, userID, coffinID); !ok {
			return
		}
		presignPDFUpload(ctx, w, r, blobs, coffinSolutionPDFKey(coffinID), uploadTTL)
	}
}

func FinalizeCoffinSolutionPDFPublish(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
			return
		}
		var req pdfPublishRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		q := store.New(database.Pool())
		if _, ok := loadCoffinForWrite(ctx, w, r, q, userID, coffinID); !ok {
			return
		}
		key := coffinSolutionPDFKey(coffinID)
		if req.ObjectKey != key {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "object_key does not match this coffin")
			return
		}
		if !statValidatePDF(ctx, w, r, blobs, key) {
			return
		}
		c, err := q.SetCoffinSolutionPdf(ctx, store.SetCoffinSolutionPdfParams{ID: coffinID, SolutionPdfObjectKey: &key})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish разбор")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(c))
	}
}

func DownloadCoffinSolutionPDF(database *db.DB, blobs objectstore.Store, ttl time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
			return
		}
		q := store.New(database.Pool())
		c, isTeacher, ok := loadCoffinForRead(ctx, w, r, q, userID, coffinID)
		if !ok {
			return
		}
		if !isTeacher && !coffinReleased(c, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if c.SolutionPdfObjectKey == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор pdf uploaded yet")
			return
		}
		redirectToPDF(ctx, w, r, blobs, *c.SolutionPdfObjectKey, ttl)
	}
}

// --- coffin разбор: external link ------------------------------------------

func SetCoffinSolutionLinkHandler(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		coffinID, err := pathInt64(r, "coffinID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid coffin id")
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
		if _, ok := loadCoffinForWrite(ctx, w, r, q, userID, coffinID); !ok {
			return
		}
		var linkPtr *string
		if link != "" {
			linkPtr = &link
		}
		c, err := q.SetCoffinSolutionLink(ctx, store.SetCoffinSolutionLinkParams{ID: coffinID, SolutionLink: linkPtr})
		if err != nil {
			logger.LogErrorContext(ctx, "coffins: set solution link", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save link")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, toCoffinActionView(c))
	}
}
