package mathcenter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// MaxPDFBytes is the upload cap for series PDFs. Real exam-style series PDFs
// are well under this; the cap is there to fail loudly on accidental wrong
// files (full books, scanned dumps) rather than silently chewing storage.
const MaxPDFBytes int64 = 1 << 20 // 1 MiB

// MaxTexBytes is the cap on the raw LaTeX source. A typical pset (with
// Russian babel, math, problem lists) is well under 100 KiB; we leave
// headroom for embedded base64 images or unusually long write-ups.
const MaxTexBytes = 512 * 1024

// pdfContentType is the only Content-Type we accept on the publish endpoint.
const pdfContentType = "application/pdf"

// pdfObjectKey is the canonical bucket key for a series PDF. Using the
// series id (not a random uuid) keeps the bucket browsable; replacing a
// previous upload is a simple Put-over.
func pdfObjectKey(seriesID int64) string {
	return fmt.Sprintf("mathcenter/series/%d.pdf", seriesID)
}

// API DTOs -------------------------------------------------------------------

type problemSpec struct {
	Number          int `json:"number"`
	SubproblemCount int `json:"subproblem_count"`
}

type createSeriesRequest struct {
	Number   int           `json:"number"`
	Name     string        `json:"name"`
	DueAt    time.Time     `json:"due_at"`
	Problems []problemSpec `json:"problems"`
}

type updateSeriesRequest struct {
	Number   int           `json:"number"`
	Name     string        `json:"name"`
	DueAt    time.Time     `json:"due_at"`
	Problems []problemSpec `json:"problems"`
}

type problemView struct {
	ID          int64    `json:"id"`
	Number      int      `json:"number"`
	DisplayName string   `json:"display_name"`
	Subproblems []string `json:"subproblems"`
}

type seriesView struct {
	ID           int64         `json:"id"`
	MathCenterID int64         `json:"math_center_id"`
	Number       int           `json:"number"`
	Name         string        `json:"name"`
	DisplayName  string        `json:"display_name"`
	DueAt        time.Time     `json:"due_at"`
	Published    bool          `json:"published"`
	PublishedAt  *time.Time    `json:"published_at,omitempty"`
	HasPDF       bool          `json:"has_pdf"`
	HasTex       bool          `json:"has_tex"`
	Problems     []problemView `json:"problems"`
}

// Handlers -------------------------------------------------------------------

// CreateSeries — teacher-only. Persists the series, then its problems and
// subproblems. Each problem's subproblem labels are derived ('a'..) from the
// requested count via the domain helper, so the API stays small.
func CreateSeries(database *db.DB) http.HandlerFunc {
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

		var req createSeriesRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if vErr := validateSeriesPayload(req.Number, req.Name, req.Problems); vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		q := store.New(database.Pool())
		isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
			UserID: userID, MathCenterID: centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "series: teacher check", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}

		// Create the series and its problems atomically: a partial write
		// would leave a series with an incomplete problem set.
		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "series: begin tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		qx := store.New(tx)

		series, err := qx.CreateSeries(ctx, store.CreateSeriesParams{
			MathCenterID: centerID,
			Number:       int32(req.Number),
			Name:         req.Name,
			DueAt:        req.DueAt,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "series number already exists in this center")
				return
			}
			logger.LogErrorContext(ctx, "series: create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create series")
			return
		}

		if err := writeProblems(ctx, qx, series.ID, req.Problems); err != nil {
			logger.LogErrorContext(ctx, "series: write problems", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create problems")
			return
		}

		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "series: commit create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		view, err := buildSeriesView(ctx, q, series)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, view)
	}
}

// ListSeriesForCenter returns every series in the center for a teacher of
// that center; for a student-member it returns only the published ones.
// Anyone else gets 403.
func ListSeriesForCenter(database *db.DB) http.HandlerFunc {
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
		isTeacher, isStudent, err := membership(ctx, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}

		var rows []store.MathCenterSeries
		if isTeacher {
			rows, err = q.ListSeriesForCenter(ctx, centerID)
		} else {
			rows, err = q.ListPublishedSeriesForCenter(ctx, centerID)
		}
		if err != nil {
			logger.LogErrorContext(ctx, "series: list", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list series")
			return
		}

		out, err := buildSeriesViews(ctx, q, rows)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build views", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// GetSeries returns a single series. Teachers see drafts; students only see
// published; non-members get 403.
func GetSeries(database *db.DB) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		isTeacher, isStudent, err := membership(ctx, q, userID, series.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this series")
			return
		}
		if !isTeacher && series.PublishedAt == nil {
			// Don't reveal that drafts exist at this id.
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return
		}

		view, err := buildSeriesView(ctx, q, series)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// UpdateSeries replaces metadata and the problems list. Subproblems are
// rebuilt to match the new spec — simpler than diffing, and handler tests
// don't have to care about reorderings.
func UpdateSeries(database *db.DB) http.HandlerFunc {
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

		var req updateSeriesRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if vErr := validateSeriesPayload(req.Number, req.Name, req.Problems); vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}

		q := store.New(database.Pool())
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "series: get for update", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		// Update the series and rebuild its problems atomically. The rebuild
		// deletes every problem (cascading to subproblems) and re-inserts; on
		// autocommit a failure between the delete and the rewrite would destroy
		// the series' problems — and any homework threads that reference them.
		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "series: begin tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		qx := store.New(tx)

		updated, err := qx.UpdateSeries(ctx, store.UpdateSeriesParams{
			ID:     series.ID,
			Number: int32(req.Number),
			Name:   req.Name,
			DueAt:  req.DueAt,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "series number already used in this center")
				return
			}
			logger.LogErrorContext(ctx, "series: update", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update series")
			return
		}

		if err := qx.DeleteProblemsForSeries(ctx, series.ID); err != nil {
			logger.LogErrorContext(ctx, "series: clear problems", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update problems")
			return
		}
		if err := writeProblems(ctx, qx, series.ID, req.Problems); err != nil {
			logger.LogErrorContext(ctx, "series: write problems", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update problems")
			return
		}

		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "series: commit update", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		view, err := buildSeriesView(ctx, q, updated)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// DeleteSeries removes the row and best-effort deletes the PDF object. We
// don't fail the request on storage errors — the row is the source of truth;
// a stranded object is a janitor problem, not a user-visible one.
func DeleteSeries(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get for delete", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		if _, err := q.DeleteSeries(ctx, series.ID); err != nil {
			logger.LogErrorContext(ctx, "series: delete", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete series")
			return
		}
		if series.PdfObjectKey != nil {
			if err := blobs.Delete(ctx, *series.PdfObjectKey); err != nil {
				logger.LogErrorContext(ctx, "series: delete blob", err)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// pdfUploadURLResponse is the body of /pdf/upload-url. The client PUTs the
// PDF bytes to UploadURL with Content-Type: application/pdf, then POSTs
// ObjectKey to /pdf/publish to commit.
type pdfUploadURLResponse struct {
	ObjectKey string `json:"object_key"`
	UploadURL string `json:"upload_url"`
}

// pdfPublishRequest is the body of /pdf/publish: the key the client just
// uploaded to. Server re-validates the key matches the canonical layout, so
// a malicious caller can't post a key the server didn't sign.
type pdfPublishRequest struct {
	ObjectKey string `json:"object_key"`
}

// IssuePDFUploadURL — teacher-only. Mints a presigned PUT URL the client
// uses to upload directly to Yandex Object Storage. The series row is not
// touched here; the publish step does that after Stat-validating the
// uploaded object.
func IssuePDFUploadURL(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get for upload-url", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		key := pdfObjectKey(series.ID)
		url, err := blobs.PresignPut(ctx, key, pdfContentType, uploadTTL)
		if err != nil {
			logger.LogErrorContext(ctx, "series: presign put", err)
			httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, pdfUploadURLResponse{ObjectKey: key, UploadURL: url})
	}
}

// FinalizePDFPublish — teacher-only. Stat-validates the just-uploaded
// object (existence, content-type=application/pdf, size <= MaxPDFBytes),
// then marks the series published. Rejecting an oversized or wrong-type
// object before the row is updated keeps the series cache truthful: if
// /publish returns 200, the bucket really has a PDF at that key.
func FinalizePDFPublish(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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

		var req pdfPublishRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}

		q := store.New(database.Pool())
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "series: get for publish", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		expectedKey := pdfObjectKey(series.ID)
		if req.ObjectKey != expectedKey {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "object_key does not match this series")
			return
		}

		size, ct, err := blobs.Stat(ctx, expectedKey)
		if err != nil {
			if errors.Is(err, objectstore.ErrNotFound) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no pdf uploaded yet")
				return
			}
			logger.LogErrorContext(ctx, "series: stat blob", err)
			httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
			return
		}
		if ct != pdfContentType {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "uploaded object is not application/pdf")
			return
		}
		if size <= 0 || size > MaxPDFBytes {
			httpx.WriteAPIError(w, r, http.StatusRequestEntityTooLarge, httpx.CodeBadRequest, "pdf exceeds size limit")
			return
		}

		key := expectedKey
		updated, err := q.PublishSeries(ctx, store.PublishSeriesParams{
			ID:           series.ID,
			PdfObjectKey: &key,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "series: mark published", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish")
			return
		}

		view, err := buildSeriesView(ctx, q, updated)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// DownloadSeriesPDF redirects to a presigned GET URL. We don't proxy the
// bytes — that would burn server bandwidth for no security benefit since
// the URL is single-use within its TTL.
func DownloadSeriesPDF(database *db.DB, blobs objectstore.Store, ttl time.Duration) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get for download", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		isTeacher, isStudent, err := membership(ctx, q, userID, series.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this series")
			return
		}
		if !isTeacher && series.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return
		}
		if series.PdfObjectKey == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no pdf uploaded yet")
			return
		}

		url, err := blobs.PresignGet(ctx, *series.PdfObjectKey, ttl)
		if err != nil {
			if errors.Is(err, objectstore.ErrNotFound) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "pdf missing in storage")
				return
			}
			logger.LogErrorContext(ctx, "series: presign", err)
			httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
			return
		}
		http.Redirect(w, r, url, http.StatusFound)
	}
}

// TeX source endpoints ------------------------------------------------------

type texPayload struct {
	Tex string `json:"tex"`
}

// PutSeriesTex — teacher-only. Stores the raw LaTeX source on the series
// row. Validates UTF-8, size cap, and the presence of \begin{document}
// so we reject obviously-malformed input early. Editing the source for
// an unpublished series flips the series to published (mirrors the PDF
// publish flow); the column update is idempotent for re-saves.
func PutSeriesTex(database *db.DB) http.HandlerFunc {
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

		var req texPayload
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if msg := validateTexSource(req.Tex); msg != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, msg)
			return
		}

		q := store.New(database.Pool())
		series, err := q.GetSeries(ctx, seriesID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
				return
			}
			logger.LogErrorContext(ctx, "series: get for tex put", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		tex := req.Tex
		updated, err := q.SetSeriesTex(ctx, store.SetSeriesTexParams{
			ID:        series.ID,
			TexSource: &tex,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "series: set tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save tex")
			return
		}
		view, err := buildSeriesView(ctx, q, updated)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view after tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// DeleteSeriesTex — teacher-only. Clears the column. The series remains
// published if it has a PDF; otherwise students will see no rendered
// content but the row is preserved (the deletion of the whole series is
// a separate endpoint).
func DeleteSeriesTex(database *db.DB) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get for tex delete", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}

		updated, err := q.ClearSeriesTex(ctx, series.ID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: clear tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to clear tex")
			return
		}
		view, err := buildSeriesView(ctx, q, updated)
		if err != nil {
			logger.LogErrorContext(ctx, "series: build view after tex clear", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// GetSeriesTex returns the raw LaTeX source as JSON so the frontend can
// feed it to LaTeX.js. Teachers always have access; students only if the
// series is published.
func GetSeriesTex(database *db.DB) http.HandlerFunc {
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
			logger.LogErrorContext(ctx, "series: get for tex fetch", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		isTeacher, isStudent, err := membership(ctx, q, userID, series.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership for tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this series")
			return
		}
		if !isTeacher && series.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return
		}
		if series.TexSource == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no tex source uploaded yet")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, texPayload{Tex: *series.TexSource})
	}
}

// validateTexSource catches obviously-bad inputs before they hit the DB.
// LaTeX.js will surface its own parse errors at render time; here we
// only refuse what we'd refuse for *any* tex source.
func validateTexSource(tex string) string {
	if tex == "" {
		return "tex source is required"
	}
	if len(tex) > MaxTexBytes {
		return fmt.Sprintf("tex source exceeds %d bytes", MaxTexBytes)
	}
	if !utf8.ValidString(tex) {
		return "tex source must be valid UTF-8"
	}
	if !strings.Contains(tex, "\\begin{document}") {
		return "tex source must contain \\begin{document}"
	}
	return ""
}

// helpers --------------------------------------------------------------------

func requireUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	userID, err := ctxcache.UserID(r.Context())
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
		return 0, false
	}
	return userID, true
}

func pathInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, key), 10, 64)
}

func membership(ctx context.Context, q *store.Queries, userID, centerID int64) (teacher, student bool, err error) {
	teacher, err = q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		return false, false, err
	}
	student, err = q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		return false, false, err
	}
	return teacher, student, nil
}

// requireTeacher gates teacher-only routes. Returns true if the request can
// continue; otherwise it has already written a 403/500 and the caller should
// just return.
func requireTeacher(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID int64) bool {
	isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "series: teacher check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if !isTeacher {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
		return false
	}
	return true
}

// maxOrdinal caps series/problem numbers well below math.MaxInt32 so the
// int32 cast at the DB boundary can never silently wrap a large client value.
const maxOrdinal = 100_000

func validateSeriesPayload(number int, name string, problems []problemSpec) string {
	if number < 0 || number > maxOrdinal {
		return fmt.Sprintf("number must be 0..%d", maxOrdinal)
	}
	if name == "" {
		return "name is required"
	}
	if len(name) > 200 {
		return "name too long"
	}
	if len(problems) == 0 {
		return "at least one problem is required"
	}
	seen := make(map[int]bool, len(problems))
	for _, p := range problems {
		if p.Number < 0 || p.Number > maxOrdinal {
			return fmt.Sprintf("problem number must be 0..%d", maxOrdinal)
		}
		if seen[p.Number] {
			return "duplicate problem number"
		}
		seen[p.Number] = true
		if p.SubproblemCount < 0 || p.SubproblemCount > mc.MaxSubproblemsPerProblem {
			return fmt.Sprintf("subproblem_count must be 0..%d", mc.MaxSubproblemsPerProblem)
		}
	}
	return ""
}

func writeProblems(ctx context.Context, q *store.Queries, seriesID int64, specs []problemSpec) error {
	for _, p := range specs {
		problem, err := q.CreateProblem(ctx, store.CreateProblemParams{
			SeriesID: seriesID,
			Number:   int32(p.Number),
		})
		if err != nil {
			return err
		}
		labels := mc.SubproblemLabels(p.SubproblemCount)
		// Problems without real subparts still need one row so the
		// homework feature can FK its threads to a stable subproblem id.
		// We use label='' as a sentinel; buildSeriesView hides it from
		// the API response.
		if len(labels) == 0 {
			if _, err := q.CreateSubproblem(ctx, store.CreateSubproblemParams{
				ProblemID: problem.ID,
				Label:     "",
			}); err != nil {
				return err
			}
			continue
		}
		for _, label := range labels {
			if _, err := q.CreateSubproblem(ctx, store.CreateSubproblemParams{
				ProblemID: problem.ID,
				Label:     label,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func buildSeriesView(ctx context.Context, q *store.Queries, s store.MathCenterSeries) (*seriesView, error) {
	problems, err := q.ListProblemsForSeries(ctx, s.ID)
	if err != nil {
		return nil, fmt.Errorf("list problems for series: %w", err)
	}
	subs, err := q.ListSubproblemsForSeries(ctx, s.ID)
	if err != nil {
		return nil, fmt.Errorf("list subproblems for series: %w", err)
	}
	return assembleSeriesView(s, problems, labelsByProblem(subs)), nil
}

// buildSeriesViews builds views for a set of series with a fixed two queries
// regardless of how many series, instead of the 2N a per-series loop issues.
// Used by the list endpoint.
func buildSeriesViews(ctx context.Context, q *store.Queries, series []store.MathCenterSeries) ([]seriesView, error) {
	if len(series) == 0 {
		return []seriesView{}, nil
	}
	ids := make([]int64, len(series))
	for i, s := range series {
		ids[i] = s.ID
	}
	problems, err := q.ListProblemsForSeriesIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list problems for series ids: %w", err)
	}
	subs, err := q.ListSubproblemsForSeriesIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list subproblems for series ids: %w", err)
	}

	problemsBySeries := make(map[int64][]store.MathCenterProblem, len(series))
	for _, p := range problems {
		problemsBySeries[p.SeriesID] = append(problemsBySeries[p.SeriesID], p)
	}
	byProblem := make(map[int64][]string, len(problems))
	for _, sp := range subs {
		if sp.Label == "" {
			continue
		}
		byProblem[sp.ProblemID] = append(byProblem[sp.ProblemID], sp.Label)
	}

	out := make([]seriesView, 0, len(series))
	for _, s := range series {
		out = append(out, *assembleSeriesView(s, problemsBySeries[s.ID], byProblem))
	}
	return out, nil
}

// labelsByProblem buckets the single-series subproblem rows into a
// problem-id → labels map for assembleSeriesView.
func labelsByProblem(subs []store.ListSubproblemsForSeriesRow) map[int64][]string {
	byProblem := make(map[int64][]string, len(subs))
	for _, sp := range subs {
		// Hide sentinel labels: a problem declared with subproblem_count=0
		// still has one anchor subproblem row (label=''), but should look
		// subpart-less to clients.
		if sp.Label == "" {
			continue
		}
		byProblem[sp.ProblemID] = append(byProblem[sp.ProblemID], sp.Label)
	}
	return byProblem
}

// assembleSeriesView builds a seriesView from already-fetched problems and a
// problem-id → subproblem-labels map.
func assembleSeriesView(s store.MathCenterSeries, problems []store.MathCenterProblem, byProblem map[int64][]string) *seriesView {
	pviews := make([]problemView, 0, len(problems))
	for _, p := range problems {
		labels := byProblem[p.ID]
		if labels == nil {
			labels = []string{}
		}
		pviews = append(pviews, problemView{
			ID:          p.ID,
			Number:      int(p.Number),
			DisplayName: mc.ProblemDisplayName(int(p.Number)),
			Subproblems: labels,
		})
	}
	return &seriesView{
		ID:           s.ID,
		MathCenterID: s.MathCenterID,
		Number:       int(s.Number),
		Name:         s.Name,
		DisplayName:  mc.SeriesDisplayName(int(s.Number), s.Name),
		DueAt:        s.DueAt,
		Published:    s.PublishedAt != nil,
		PublishedAt:  s.PublishedAt,
		HasPDF:       s.PdfObjectKey != nil,
		HasTex:       s.TexSource != nil,
		Problems:     pviews,
	}
}

// isUniqueViolation lets handlers surface 23505 → 409. Uses the SQLState
// interface so we don't need to import pgconn here.
func isUniqueViolation(err error) bool {
	type pgCoded interface{ SQLState() string }
	var p pgCoded
	if errors.As(err, &p) {
		return p.SQLState() == "23505"
	}
	return false
}
