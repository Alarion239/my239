// Package admin contains the /api/v1/admin endpoints. All routes mounted
// here are gated by middleware.AuthMiddleware + middleware.AdminMiddleware,
// so handlers may assume r.Context() carries an authenticated admin user.
package admin

import (
	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
)

// Router wires up admin endpoints. Mount at /api/v1/admin in the main router.
func Router(database *db.DB, tokens *internalAuth.TokenService) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))
	r.Use(middleware.AdminMiddleware)

	r.Get("/users", ListUsers(database))
	r.Patch("/users/{id}/admin", SetUserAdmin(database))

	r.Get("/tokens", ListTokens(database))
	r.Post("/tokens", CreateToken(database))
	r.Delete("/tokens/{id}", RevokeToken(database))

	return r
}
