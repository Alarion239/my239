package auth

import (
	"errors"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

// Me returns the current authenticated user's information.
func Me(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, user, err := ctxcache.EnsureUser(r.Context(), database)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, ctxcache.ErrNoUserIDFound) {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
				return
			}
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to fetch user")
			return
		}
		*r = *r.WithContext(ctx)

		httpx.WriteJSON(w, http.StatusOK, user)
	}
}
