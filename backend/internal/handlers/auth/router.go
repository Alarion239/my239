// Package auth contains the HTTP handlers for the authentication endpoints:
// register, login, logout, token refresh, and the current-user lookup.
package auth

import (
	"github.com/go-chi/chi/v5"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/ratelimit"
)

// Router returns a chi sub-router for all /auth endpoints.
// Mount it at /api/v1/auth in the main router.
//
// Per-endpoint rate limits sit between coarse global protection (no global
// limit; we trust upstream / Cloudflare for that) and what each endpoint can
// reasonably tolerate. login + refresh are tighter than register because
// they're attractive bruteforce targets.
func Router(database *db.DB, tokens *internalAuth.TokenService, limiter ratelimit.Limiter) chi.Router {
	r := chi.NewRouter()

	r.With(limiter.Middleware("auth.register", 10, 60)).
		Post("/register", Register(database, tokens))
	r.With(limiter.Middleware("auth.login", 10, 60)).
		Post("/login", Login(database, tokens))
	r.With(limiter.Middleware("auth.refresh", 30, 60)).
		Post("/refresh", Refresh(database, tokens))
	// Public lookup so the registration page can describe what an invite link
	// grants (center/role/group) before the user submits.
	r.With(limiter.Middleware("auth.invite", 30, 60)).
		Get("/invite/{token}", InviteLookup(database))
	r.With(limiter.Middleware("auth.logout", 30, 60)).
		Post("/logout", Logout(tokens))

	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddleware(tokens.Access()))
		r.With(limiter.Middleware("auth.me", 60, 60)).Get("/me", Me(database))
	})

	return r
}
