package mathcenter

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type termView struct {
	ID           int64  `json:"id"`
	MathCenterID int64  `json:"math_center_id"`
	Kind         string `json:"kind"`
	Grade        *int32 `json:"grade,omitempty"`
	DisplayName  string `json:"display_name"`
	IsActive     bool   `json:"is_active"`
}

func toTermView(t store.MathCenterTerm) termView {
	return termView{
		ID:           t.ID,
		MathCenterID: t.MathCenterID,
		Kind:         t.Kind,
		Grade:        t.Grade,
		DisplayName:  mc.TermDisplayName(t.Kind, t.Grade),
		IsActive:     t.IsActive,
	}
}

// ListTermsForCenter returns the active term followed by the archive. Any
// current cohort member can inspect this catalog; write operations remain
// head-teacher-only.
func ListTermsForCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, err := ctxcache.UserID(ctx)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
			return
		}
		centerID, err := strconv.ParseInt(chi.URLParam(r, "centerID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
			return
		}
		q := store.New(database.Pool())
		isTeacher, isStudent, err := membership(ctx, r, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "terms: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}
		terms, err := q.ListTermsForCenter(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "terms: list", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list terms")
			return
		}
		out := make([]termView, 0, len(terms))
		for _, term := range terms {
			out = append(out, toTermView(term))
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

type createTermRequest struct {
	Kind  string `json:"kind"`
	Grade int32  `json:"grade"`
}

// CreateTerm creates and activates the next normal term in one transaction.
// Only group names are copied; a new student roster is always intentional.
func CreateTerm(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req createTermRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if _, valid := mc.TermStage(req.Kind, req.Grade); !valid {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term kind or grade")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "terms: begin create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		txq := store.New(tx)
		terms, err := txq.ListTermsForCenter(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "terms: list before create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create term")
			return
		}
		if !isNextTerm(terms, req.Kind, req.Grade) {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "term does not follow the cohort sequence")
			return
		}

		var sourceTermID int64
		for _, term := range terms {
			if term.IsActive {
				sourceTermID = term.ID
				break
			}
		}
		if sourceTermID == 0 {
			for _, term := range terms {
				if term.Kind == mc.TermKindLegacy {
					sourceTermID = term.ID
					break
				}
			}
		}
		if err := txq.ArchiveActiveTermsForCenter(ctx, centerID); err != nil {
			logger.LogErrorContext(ctx, "terms: archive active", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create term")
			return
		}
		term, err := txq.CreateMathCenterTerm(ctx, store.CreateMathCenterTermParams{
			MathCenterID: centerID,
			Kind:         req.Kind,
			Grade:        &req.Grade,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "term already exists")
				return
			}
			logger.LogErrorContext(ctx, "terms: create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create term")
			return
		}
		if sourceTermID != 0 {
			if err := txq.CopyGroupsToTerm(ctx, store.CopyGroupsToTermParams{
				TermID:   sourceTermID,
				TermID_2: term.ID,
			}); err != nil {
				logger.LogErrorContext(ctx, "terms: copy groups", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create term")
				return
			}
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "terms: commit create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create term")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, toTermView(term))
	}
}

func isNextTerm(terms []store.MathCenterTerm, kind string, grade int32) bool {
	requested, valid := mc.TermStage(kind, grade)
	if !valid {
		return false
	}
	last := 0
	for _, term := range terms {
		if term.Kind == mc.TermKindLegacy || term.Grade == nil {
			continue
		}
		stage, ok := mc.TermStage(term.Kind, *term.Grade)
		if ok && stage > last {
			last = stage
		}
	}
	// A legacy-only center is allowed to begin its new live history at the
	// grade it is actually entering. Subsequent terms are strictly sequential.
	return last == 0 || requested == last+1
}

// selectedTerm resolves ?term_id= for archive views and otherwise uses the
// active term, falling back to the imported legacy term before the first
// rollover. It also prevents guessed term ids from crossing cohort boundaries.
func selectedTerm(ctx context.Context, r *http.Request, q *store.Queries, centerID int64) (store.MathCenterTerm, error) {
	termParam := r.URL.Query().Get("term_id")
	if termParam != "" {
		termID, err := strconv.ParseInt(termParam, 10, 64)
		if err != nil || termID <= 0 {
			return store.MathCenterTerm{}, errInvalidTerm
		}
		term, err := q.GetTerm(ctx, termID)
		if err != nil || term.MathCenterID != centerID {
			return store.MathCenterTerm{}, errInvalidTerm
		}
		return term, nil
	}
	term, err := q.GetActiveTermForCenter(ctx, centerID)
	if err == nil {
		return term, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return store.MathCenterTerm{}, err
	}
	return q.GetLegacyTermForCenter(ctx, centerID)
}

var errInvalidTerm = errors.New("invalid term")
