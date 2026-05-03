// Package mathcenter exposes the /api/v1/mathcenter HTTP surface.
package mathcenter

import (
	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
)

// Router mounts the math center routes. All endpoints require an authenticated
// user; role-based visibility (teacher vs student) is decided in the handler.
func Router(database *db.DB, tokens *internalAuth.TokenService) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))

	r.Get("/me", Me(database))
	return r
}
