package auth

import (
	"time"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
)

// Router returns a chi sub-router for all /auth endpoints.
// Mount it at /api/v1/auth in the main router.
func Router(database *db.DB, jwtSvc *internalAuth.JWTService) chi.Router {
	r := chi.NewRouter()

	// Public endpoints
	r.With(httprate.LimitByIP(100, time.Minute)).Post("/register", Register(database, jwtSvc))
	r.With(httprate.LimitByIP(20, time.Minute)).Post("/login", Login(database, jwtSvc))

	// Protected endpoints — require valid JWT
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddleware(jwtSvc))
		r.With(httprate.LimitByIP(200, time.Minute)).Get("/me", Me(database))
	})

	return r
}
