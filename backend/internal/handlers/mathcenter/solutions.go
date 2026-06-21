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
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Series-level "Разбор" (official solutions): the whole pset's solutions,
// authored like the statement (TeX / PDF) plus an external link (covers video
// разборы and off-site write-ups). Visible to students only once the series
// deadline has passed; teachers always.

// MaxSolutionLinkLen caps the external link (a URL to a video/разбор elsewhere).
const MaxSolutionLinkLen = 2000

func seriesSolutionPDFKey(seriesID int64) string {
	return fmt.Sprintf("mathcenter/series/%d.solution.pdf", seriesID)
}

// validateSolutionLink accepts an http(s) URL within the length cap, or "" to
// clear the link.
func validateSolutionLink(link string) string {
	if link == "" {
		return ""
	}
	if len(link) > MaxSolutionLinkLen {
		return "link too long"
	}
	if !strings.HasPrefix(link, "http://") && !strings.HasPrefix(link, "https://") {
		return "link must start with http:// or https://"
	}
	return ""
}

// loadSeries fetches a series or writes 404/500. Shared by solution handlers.
func loadSeries(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, seriesID int64) (store.MathCenterSeries, bool) {
	series, err := q.GetSeries(ctx, seriesID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "series not found")
			return store.MathCenterSeries{}, false
		}
		logger.LogErrorContext(ctx, "series: get", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterSeries{}, false
	}
	return series, true
}

// solutionVisibleToStudent reports whether a non-teacher may see the series
// разбор: the series is published and its deadline has passed.
func solutionVisibleToStudent(s store.MathCenterSeries, now time.Time) bool {
	return s.PublishedAt != nil && !now.Before(s.DueAt)
}

// --- shared PDF presign/validate (series-solution + coffin reuse) -----------

// presignPDFUpload mints a presigned PUT URL for key and writes the response.
// The caller must have already authorized the request.
func presignPDFUpload(ctx context.Context, w http.ResponseWriter, r *http.Request, blobs objectstore.Store, key string, uploadTTL time.Duration) {
	url, err := blobs.PresignPut(ctx, key, pdfContentType, uploadTTL)
	if err != nil {
		logger.LogErrorContext(ctx, "presign put", err)
		httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, pdfUploadURLResponse{ObjectKey: key, UploadURL: url})
}

// statValidatePDF confirms the uploaded object exists, is a PDF, and is within
// the size cap. Writes the error response and returns false on failure.
func statValidatePDF(ctx context.Context, w http.ResponseWriter, r *http.Request, blobs objectstore.Store, key string) bool {
	size, ct, err := blobs.Stat(ctx, key)
	if err != nil {
		if errors.Is(err, objectstore.ErrNotFound) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no pdf uploaded yet")
			return false
		}
		logger.LogErrorContext(ctx, "stat blob", err)
		httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
		return false
	}
	if ct != pdfContentType {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "uploaded object is not application/pdf")
		return false
	}
	if size <= 0 || size > MaxPDFBytes {
		httpx.WriteAPIError(w, r, http.StatusRequestEntityTooLarge, httpx.CodeBadRequest, "pdf exceeds size limit")
		return false
	}
	return true
}

// redirectToPDF presigns a GET URL for key and 302s to it.
func redirectToPDF(ctx context.Context, w http.ResponseWriter, r *http.Request, blobs objectstore.Store, key string, ttl time.Duration) {
	url, err := blobs.PresignGet(ctx, key, ttl)
	if err != nil {
		if errors.Is(err, objectstore.ErrNotFound) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "pdf missing in storage")
			return
		}
		logger.LogErrorContext(ctx, "presign get", err)
		httpx.WriteAPIError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "object storage unavailable")
		return
	}
	http.Redirect(w, r, url, http.StatusFound)
}

// --- series разбор: TeX ----------------------------------------------------

// PutSeriesSolutionTex — teacher-only. Stores the разбор LaTeX source.
func PutSeriesSolutionTex(database *db.DB) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		tex := req.Tex
		updated, err := q.SetSeriesSolutionTex(ctx, store.SetSeriesSolutionTexParams{ID: series.ID, SolutionTexSource: &tex})
		if err != nil {
			logger.LogErrorContext(ctx, "series: set solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save разбор")
			return
		}
		writeSeriesView(ctx, w, r, q, updated)
	}
}

// DeleteSeriesSolutionTex — teacher-only. Clears the разбор LaTeX.
func DeleteSeriesSolutionTex(database *db.DB) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		updated, err := q.ClearSeriesSolutionTex(ctx, series.ID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: clear solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to clear разбор")
			return
		}
		writeSeriesView(ctx, w, r, q, updated)
	}
}

// GetSeriesSolutionTex — teacher always; student only once due_at has passed.
func GetSeriesSolutionTex(database *db.DB) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		isTeacher, isStudent, err := membership(ctx, r, q, userID, series.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership for solution tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this series")
			return
		}
		if !isTeacher && !solutionVisibleToStudent(series, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if series.SolutionTexSource == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор tex uploaded yet")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, texPayload{Tex: *series.SolutionTexSource})
	}
}

// --- series разбор: PDF ----------------------------------------------------

// IssueSolutionPDFUploadURL — teacher-only. Presigned PUT for the разбор PDF.
func IssueSolutionPDFUploadURL(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		presignPDFUpload(ctx, w, r, blobs, seriesSolutionPDFKey(series.ID), uploadTTL)
	}
}

// FinalizeSolutionPDFPublish — teacher-only. Stat-validates + records the key.
func FinalizeSolutionPDFPublish(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		key := seriesSolutionPDFKey(series.ID)
		if req.ObjectKey != key {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "object_key does not match this series")
			return
		}
		if !statValidatePDF(ctx, w, r, blobs, key) {
			return
		}
		updated, err := q.SetSeriesSolutionPdf(ctx, store.SetSeriesSolutionPdfParams{ID: series.ID, SolutionPdfObjectKey: &key})
		if err != nil {
			logger.LogErrorContext(ctx, "series: set solution pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish разбор")
			return
		}
		writeSeriesView(ctx, w, r, q, updated)
	}
}

// DownloadSeriesSolutionPDF — teacher always; student once due_at has passed.
func DownloadSeriesSolutionPDF(database *db.DB, blobs objectstore.Store, ttl time.Duration) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		isTeacher, isStudent, err := membership(ctx, r, q, userID, series.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "series: membership for solution pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this series")
			return
		}
		if !isTeacher && !solutionVisibleToStudent(series, time.Now()) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "разбор not available yet")
			return
		}
		if series.SolutionPdfObjectKey == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no разбор pdf uploaded yet")
			return
		}
		redirectToPDF(ctx, w, r, blobs, *series.SolutionPdfObjectKey, ttl)
	}
}

// --- series разбор: external link ------------------------------------------

type solutionLinkPayload struct {
	Link string `json:"link"`
}

// SetSeriesSolutionLinkHandler — teacher-only. Sets or clears (empty) the link.
func SetSeriesSolutionLinkHandler(database *db.DB) http.HandlerFunc {
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
		series, ok := loadSeries(ctx, w, r, q, seriesID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, series.MathCenterID) {
			return
		}
		var linkPtr *string
		if link != "" {
			linkPtr = &link
		}
		updated, err := q.SetSeriesSolutionLink(ctx, store.SetSeriesSolutionLinkParams{ID: series.ID, SolutionLink: linkPtr})
		if err != nil {
			logger.LogErrorContext(ctx, "series: set solution link", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save link")
			return
		}
		writeSeriesView(ctx, w, r, q, updated)
	}
}

// writeSeriesView builds + writes a 200 seriesView, or a 500 on build failure.
func writeSeriesView(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, s store.MathCenterSeries) {
	view, err := buildSeriesView(ctx, q, s)
	if err != nil {
		logger.LogErrorContext(ctx, "series: build view", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, view)
}
