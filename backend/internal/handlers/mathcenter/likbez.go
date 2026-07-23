package mathcenter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

const likbezDateLayout = "2006-01-02"

type likbezRequest struct {
	TermID      int64  `json:"term_id"`
	Number      int    `json:"number"`
	Title       string `json:"title"`
	HeldOn      string `json:"held_on"`
	Description string `json:"description"`
}

type createLikbezRequest struct {
	TermID      int64  `json:"term_id"`
	Title       string `json:"title"`
	HeldOn      string `json:"held_on"`
	Description string `json:"description"`
}

type likbezView struct {
	ID              int64      `json:"id"`
	MathCenterID    int64      `json:"math_center_id"`
	TermID          int64      `json:"term_id"`
	TermDisplayName string     `json:"term_display_name"`
	Number          int        `json:"number"`
	Title           string     `json:"title"`
	HeldOn          string     `json:"held_on"`
	Description     string     `json:"description"`
	Published       bool       `json:"published"`
	PublishedAt     *time.Time `json:"published_at,omitempty"`
	HasPDF          bool       `json:"has_pdf"`
	HasTex          bool       `json:"has_tex"`
	VideoURL        *string    `json:"video_url,omitempty"`
}

func likbezObjectKey(likbezID int64) string {
	return fmt.Sprintf("mathcenter/likbez/%d.pdf", likbezID)
}

func parseLikbezDate(value string) (pgtype.Date, string) {
	date, err := time.Parse(likbezDateLayout, value)
	if err != nil {
		return pgtype.Date{}, "held_on must be a calendar date"
	}
	return pgtype.Date{Time: date, Valid: true}, ""
}

func validateLikbezFields(termID int64, number int, title, heldOn, description string) (pgtype.Date, string) {
	if termID <= 0 {
		return pgtype.Date{}, "term_id is required"
	}
	if number < 1 || number > maxOrdinal {
		return pgtype.Date{}, fmt.Sprintf("number must be 1..%d", maxOrdinal)
	}
	if title == "" || len(title) > 200 {
		return pgtype.Date{}, "title must be 1..200 characters"
	}
	if description == "" || len(description) > 4000 {
		return pgtype.Date{}, "description must be 1..4000 characters"
	}
	return parseLikbezDate(heldOn)
}

func validateLikbezCreateFields(termID int64, title, heldOn, description string) (pgtype.Date, string) {
	if termID <= 0 {
		return pgtype.Date{}, "term_id is required"
	}
	if title == "" || len(title) > 200 {
		return pgtype.Date{}, "title must be 1..200 characters"
	}
	if description == "" || len(description) > 4000 {
		return pgtype.Date{}, "description must be 1..4000 characters"
	}
	return parseLikbezDate(heldOn)
}

func likbezViewFromGet(row store.GetLikbezRow) likbezView {
	return likbezView{
		ID:              row.ID,
		MathCenterID:    row.MathCenterID,
		TermID:          row.TermID,
		TermDisplayName: mc.TermDisplayName(row.TermKind, row.TermGrade),
		Number:          int(row.Number),
		Title:           row.Title,
		HeldOn:          row.HeldOn.Time.Format(likbezDateLayout),
		Description:     row.Description,
		Published:       row.PublishedAt != nil,
		PublishedAt:     row.PublishedAt,
		HasPDF:          row.PdfObjectKey != nil,
		HasTex:          row.TexSource != nil,
		VideoURL:        row.VideoUrl,
	}
}

func likbezViewFromList(row store.ListLikbezForCenterRow) likbezView {
	return likbezView{
		ID:              row.ID,
		MathCenterID:    row.MathCenterID,
		TermID:          row.TermID,
		TermDisplayName: mc.TermDisplayName(row.TermKind, row.TermGrade),
		Number:          int(row.Number),
		Title:           row.Title,
		HeldOn:          row.HeldOn.Time.Format(likbezDateLayout),
		Description:     row.Description,
		Published:       row.PublishedAt != nil,
		PublishedAt:     row.PublishedAt,
		HasPDF:          row.PdfObjectKey != nil,
		HasTex:          row.TexSource != nil,
		VideoURL:        row.VideoUrl,
	}
}

func likbezViewFromPublishedList(row store.ListPublishedLikbezForCenterRow) likbezView {
	return likbezView{
		ID:              row.ID,
		MathCenterID:    row.MathCenterID,
		TermID:          row.TermID,
		TermDisplayName: mc.TermDisplayName(row.TermKind, row.TermGrade),
		Number:          int(row.Number),
		Title:           row.Title,
		HeldOn:          row.HeldOn.Time.Format(likbezDateLayout),
		Description:     row.Description,
		Published:       true,
		PublishedAt:     row.PublishedAt,
		HasPDF:          row.PdfObjectKey != nil,
		HasTex:          row.TexSource != nil,
		VideoURL:        row.VideoUrl,
	}
}

func getLikbezView(ctx context.Context, q *store.Queries, likbezID int64) (store.GetLikbezRow, likbezView, error) {
	row, err := q.GetLikbez(ctx, likbezID)
	if err != nil {
		return store.GetLikbezRow{}, likbezView{}, err
	}
	return row, likbezViewFromGet(row), nil
}

func validLikbezTerm(ctx context.Context, q *store.Queries, termID, centerID int64) bool {
	term, err := q.GetTerm(ctx, termID)
	return err == nil && term.MathCenterID == centerID
}

func publishLikbezChanged(ctx context.Context, database *db.DB, centerID int64) {
	live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindLikbez})
}

// CreateLikbez creates a draft and assigns the next center-wide number under a
// parent-row lock. A period is required as historical metadata, not a filter.
func CreateLikbez(database *db.DB) http.HandlerFunc {
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
		var req createLikbezRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		req.Title = strings.TrimSpace(req.Title)
		req.Description = strings.TrimSpace(req.Description)
		heldOn, message := validateLikbezCreateFields(req.TermID, req.Title, req.HeldOn, req.Description)
		if message != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, message)
			return
		}

		q := store.New(database.Pool())
		if !requireTeacher(ctx, w, r, q, userID, centerID) {
			return
		}
		if !validLikbezTerm(ctx, q, req.TermID, centerID) {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: begin create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		txq := store.New(tx)
		if _, err := txq.LockMathCenterForLikbezNumbering(ctx, centerID); err != nil {
			logger.LogErrorContext(ctx, "likbez: lock center", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create likbez")
			return
		}
		number, err := txq.NextLikbezNumber(ctx, centerID)
		if err != nil || number > maxOrdinal {
			if err != nil {
				logger.LogErrorContext(ctx, "likbez: next number", err)
			}
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "no likbez number available")
			return
		}
		created, err := txq.CreateLikbez(ctx, store.CreateLikbezParams{
			MathCenterID: centerID,
			TermID:       req.TermID,
			Number:       number,
			Title:        req.Title,
			HeldOn:       heldOn,
			Description:  req.Description,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create likbez")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "likbez: commit create", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		_, view, err := getLikbezView(ctx, q, created.ID)
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: build create view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(ctx, database, centerID)
		httpx.WriteJSON(w, http.StatusCreated, view)
	}
}

func ListLikbezForCenter(database *db.DB) http.HandlerFunc {
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
		teacher, student, err := membership(ctx, r, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: list membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !teacher && !student {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}
		if teacher {
			rows, err := q.ListLikbezForCenter(ctx, centerID)
			if err != nil {
				logger.LogErrorContext(ctx, "likbez: list", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list likbez")
				return
			}
			out := make([]likbezView, 0, len(rows))
			for _, row := range rows {
				out = append(out, likbezViewFromList(row))
			}
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		rows, err := q.ListPublishedLikbezForCenter(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: list published", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list likbez")
			return
		}
		out := make([]likbezView, 0, len(rows))
		for _, row := range rows {
			out = append(out, likbezViewFromPublishedList(row))
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func GetLikbez(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, _ *store.Queries, _ store.GetLikbezRow, view likbezView, _ bool) {
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func UpdateLikbez(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		var req likbezRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		req.Title = strings.TrimSpace(req.Title)
		req.Description = strings.TrimSpace(req.Description)
		heldOn, message := validateLikbezFields(req.TermID, req.Number, req.Title, req.HeldOn, req.Description)
		if message != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, message)
			return
		}
		if !validLikbezTerm(r.Context(), q, req.TermID, row.MathCenterID) {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid term")
			return
		}
		if _, err := q.UpdateLikbez(r.Context(), store.UpdateLikbezParams{ID: row.ID, TermID: req.TermID, Number: int32(req.Number), Title: req.Title, HeldOn: heldOn, Description: req.Description}); err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "likbez number already used in this center")
				return
			}
			logger.LogErrorContext(r.Context(), "likbez: update", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update likbez")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build update view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func DeleteLikbez(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		if _, err := q.DeleteLikbez(r.Context(), row.ID); err != nil {
			logger.LogErrorContext(r.Context(), "likbez: delete", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete likbez")
			return
		}
		if row.PdfObjectKey != nil {
			if err := blobs.Delete(r.Context(), *row.PdfObjectKey); err != nil {
				logger.LogErrorContext(r.Context(), "likbez: delete pdf", err)
			}
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		w.WriteHeader(http.StatusNoContent)
	})
}

func IssueLikbezPDFUploadURL(database *db.DB, blobs objectstore.Store, uploadTTL time.Duration) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, _ *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		presignPDFUpload(r.Context(), w, r, blobs, likbezObjectKey(row.ID), uploadTTL)
	})
}

func FinalizeLikbezPDF(database *db.DB, blobs objectstore.Store) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		var req pdfPublishRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		key := likbezObjectKey(row.ID)
		if req.ObjectKey != key {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "object_key does not match this likbez")
			return
		}
		if !statValidatePDF(r.Context(), w, r, blobs, key) {
			return
		}
		if _, err := q.SetLikbezPDF(r.Context(), store.SetLikbezPDFParams{ID: row.ID, PdfObjectKey: &key}); err != nil {
			logger.LogErrorContext(r.Context(), "likbez: set pdf", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save pdf")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build pdf view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func DownloadLikbezPDF(database *db.DB, blobs objectstore.Store, ttl time.Duration) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, _ *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher && row.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "likbez not found")
			return
		}
		if row.PdfObjectKey == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no pdf uploaded yet")
			return
		}
		redirectToPDF(r.Context(), w, r, blobs, *row.PdfObjectKey, ttl)
	})
}

func PutLikbezTex(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		var req texPayload
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if message := validateTexSource(req.Tex); message != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, message)
			return
		}
		if _, err := q.SetLikbezTex(r.Context(), store.SetLikbezTexParams{ID: row.ID, TexSource: &req.Tex}); err != nil {
			logger.LogErrorContext(r.Context(), "likbez: set tex", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save tex")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build tex view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func GetLikbezTex(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, _ *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher && row.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "likbez not found")
			return
		}
		if row.TexSource == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "no tex source uploaded yet")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, texPayload{Tex: *row.TexSource})
	})
}

func SetLikbezVideoURL(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		var req solutionLinkPayload
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		link := strings.TrimSpace(req.Link)
		if message := validateSolutionLink(link); message != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, message)
			return
		}
		var value *string
		if link != "" {
			value = &link
		}
		if _, err := q.SetLikbezVideoURL(r.Context(), store.SetLikbezVideoURLParams{ID: row.ID, VideoUrl: value}); err != nil {
			logger.LogErrorContext(r.Context(), "likbez: set video", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save video")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build video view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func PublishLikbez(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		if _, err := q.PublishLikbez(r.Context(), row.ID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "attach a material before publishing")
				return
			}
			logger.LogErrorContext(r.Context(), "likbez: publish", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to publish likbez")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build publish view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func UnpublishLikbez(database *db.DB) http.HandlerFunc {
	return withLikbezAccess(database, func(w http.ResponseWriter, r *http.Request, q *store.Queries, row store.GetLikbezRow, _ likbezView, teacher bool) {
		if !teacher {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
			return
		}
		if _, err := q.UnpublishLikbez(r.Context(), row.ID); err != nil {
			logger.LogErrorContext(r.Context(), "likbez: unpublish", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to unpublish likbez")
			return
		}
		_, view, err := getLikbezView(r.Context(), q, row.ID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "likbez: build unpublish view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		publishLikbezChanged(r.Context(), database, row.MathCenterID)
		httpx.WriteJSON(w, http.StatusOK, view)
	})
}

func withLikbezAccess(database *db.DB, next func(http.ResponseWriter, *http.Request, *store.Queries, store.GetLikbezRow, likbezView, bool)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		likbezID, err := pathInt64(r, "likbezID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid likbez id")
			return
		}
		q := store.New(database.Pool())
		row, view, err := getLikbezView(ctx, q, likbezID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "likbez not found")
				return
			}
			logger.LogErrorContext(ctx, "likbez: get", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		teacher, student, err := membership(ctx, r, q, userID, row.MathCenterID)
		if err != nil {
			logger.LogErrorContext(ctx, "likbez: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !teacher && !student {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}
		if !teacher && row.PublishedAt == nil {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "likbez not found")
			return
		}
		next(w, r, q, row, view, teacher)
	}
}
