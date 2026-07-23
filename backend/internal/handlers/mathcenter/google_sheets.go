package mathcenter

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/googlesheets"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type googleSheetDiscoverRequest struct {
	SpreadsheetURL string `json:"spreadsheet_url"`
}
type googleSheetLinkRequest struct {
	TermID         int64  `json:"term_id"`
	SpreadsheetURL string `json:"spreadsheet_url"`
	SheetID        int64  `json:"sheet_id"`
}
type googleSheetEnabledRequest struct {
	Enabled bool `json:"enabled"`
}
type googleSheetSyncRequest struct {
	TermID int64 `json:"term_id"`
}

func manageGoogleSheetLinks(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		links, err := sheets.ListLinks(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "google sheets: list links", err)
			httpx.WriteAPIError(w, r, 500, httpx.CodeInternal, "failed to list Google Sheets links")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, links)
	}
}

func manageGoogleSheetRuns(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		runs, err := sheets.ListRuns(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "google sheets: list runs", err)
			httpx.WriteAPIError(w, r, 500, httpx.CodeInternal, "failed to list Google Sheets sync history")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, runs)
	}
}

func manageGoogleSheetDiscover(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		_, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var request googleSheetDiscoverRequest
		if !httpx.DecodeJSONBody(w, r, &request) {
			return
		}
		spreadsheetID, tabs, err := sheets.DiscoverTabs(r.Context(), request.SpreadsheetURL)
		if writeGoogleSheetsError(w, r, err) {
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"spreadsheet_id": spreadsheetID, "tabs": tabs})
	}
}

func manageGoogleSheetCreate(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, userID, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var request googleSheetLinkRequest
		if !httpx.DecodeJSONBody(w, r, &request) {
			return
		}
		if request.TermID <= 0 || request.SheetID < 0 || strings.TrimSpace(request.SpreadsheetURL) == "" {
			httpx.WriteAPIError(w, r, 400, httpx.CodeBadRequest, "term_id, spreadsheet_url, and sheet_id are required")
			return
		}
		link, err := sheets.CreateLink(r.Context(), centerID, request.TermID, request.SheetID, userID, request.SpreadsheetURL)
		if writeGoogleSheetsError(w, r, err) {
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, link)
	}
}

func manageGoogleSheetEnabled(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		linkID, err := strconv.ParseInt(chi.URLParam(r, "linkID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, 400, httpx.CodeBadRequest, "invalid link id")
			return
		}
		var request googleSheetEnabledRequest
		if !httpx.DecodeJSONBody(w, r, &request) {
			return
		}
		if err := sheets.SetEnabled(r.Context(), centerID, linkID, request.Enabled); errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, 404, httpx.CodeNotFound, "Google Sheets link not found")
			return
		} else if writeGoogleSheetsError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageGoogleSheetDelete(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		linkID, err := strconv.ParseInt(chi.URLParam(r, "linkID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, 400, httpx.CodeBadRequest, "invalid link id")
			return
		}
		if err := sheets.DeleteLink(r.Context(), centerID, linkID); errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, 404, httpx.CodeNotFound, "Google Sheets link not found")
			return
		} else if writeGoogleSheetsError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// SyncGoogleSheets is teacher-facing while configuration stays under the
// head-teacher management router.
func SyncGoogleSheets(database *db.DB, sheets *googlesheets.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := strconv.ParseInt(chi.URLParam(r, "centerID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, 400, httpx.CodeBadRequest, "invalid center id")
			return
		}
		userID, err := ctxcache.UserID(r.Context())
		if err != nil {
			httpx.WriteAPIError(w, r, 401, httpx.CodeUnauthenticated, "unauthenticated")
			return
		}
		q := store.New(database.Pool())
		if !requireTeacher(r.Context(), w, r, q, userID, centerID) {
			return
		}
		var request googleSheetSyncRequest
		if !httpx.DecodeJSONBody(w, r, &request) {
			return
		}
		if request.TermID <= 0 {
			httpx.WriteAPIError(w, r, 400, httpx.CodeBadRequest, "term_id is required")
			return
		}
		runs, err := sheets.SyncTerm(r.Context(), centerID, request.TermID, userID)
		if writeGoogleSheetsError(w, r, err) {
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
	}
}

func writeGoogleSheetsError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, googlesheets.ErrNotConfigured) {
		httpx.WriteAPIError(w, r, http.StatusServiceUnavailable, httpx.CodeInternal, "Google Sheets is not configured")
		return true
	}
	if errors.Is(err, googlesheets.ErrParserNotConfigured) {
		httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "Google Sheets parsing is not configured yet")
		return true
	}
	logger.LogErrorContext(r.Context(), "google sheets", err)
	httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "Google Sheets operation failed")
	return true
}
