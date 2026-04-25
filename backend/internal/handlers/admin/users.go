package admin

import (
	"net/http"
	"strconv"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
)

// ListUsers returns every user in the system.
func ListUsers(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		users, err := store.New(database.Pool()).ListUsers(r.Context())
		if err != nil {
			logger.LogError("admin: list users", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list users")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, users)
	}
}

type setAdminRequest struct {
	IsAdmin bool `json:"is_admin"`
}

// SetUserAdmin promotes / demotes a user. We refuse to let an admin demote
// themselves: if a single admin in the system did that, no one would be left
// to manage the platform. Promotion of a different admin is fine.
func SetUserAdmin(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid user id")
			return
		}

		var req setAdminRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}

		callerID, err := ctxcache.UserID(r.Context())
		if err == nil && callerID == id && !req.IsAdmin {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "cannot demote yourself")
			return
		}

		q := store.New(database.Pool())
		if err := q.SetUserAdmin(r.Context(), store.SetUserAdminParams{ID: id, IsAdmin: req.IsAdmin}); err != nil {
			logger.LogError("admin: set user admin", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update user")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
