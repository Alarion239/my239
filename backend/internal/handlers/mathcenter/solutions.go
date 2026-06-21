package mathcenter

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Shared разбор helpers reused by the per-subproblem solution handlers in
// coffins.go: external-link validation and the presigned PDF upload/stat/
// download dance (mirrors the series statement PDF flow in series.go).

// MaxSolutionLinkLen caps the external link (a URL to a video/разбор elsewhere).
const MaxSolutionLinkLen = 2000

type solutionLinkPayload struct {
	Link string `json:"link"`
}

// validateSolutionLink accepts an http(s) URL within the length cap, or "" to
// clear the link. Returns an error message, or "" when valid.
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
