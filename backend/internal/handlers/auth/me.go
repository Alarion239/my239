package auth

import (
	"encoding/json"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Me returns the current authenticated user's information.
func Me(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, user, err := ctxcache.EnsureUser(database, r.Context())
		if err != nil {
			http.Error(w, "Failed to fetch user data", http.StatusInternalServerError)
			return
		}
		_ = ctx // context already propagated via r.Context() chain

		w.Header().Set("Content-Type", "application/json")
		err = json.NewEncoder(w).Encode(user)
		if err != nil {
			return
		}
	}
}
