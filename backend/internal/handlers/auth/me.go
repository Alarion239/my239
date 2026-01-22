package auth

import (
	"encoding/json"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Me returns the current authenticated user's information
func Me(database *db.DB, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// Get user from context (fetches from DB if not cached)
	ctx, user, err := ctxcache.EnsureUser(database, ctx)
	if err != nil {
		http.Error(w, "Failed to fetch user data", http.StatusInternalServerError)
		return
	}

	// Update request context with cached user for downstream handlers
	r = r.WithContext(ctx)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
