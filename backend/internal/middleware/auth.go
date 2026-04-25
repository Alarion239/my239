package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/httpx"
)

// AuthMiddleware validates JWT tokens and injects user info into context.
// On failure it emits the same JSON error envelope the rest of the API uses.
func AuthMiddleware(jwtSvc *auth.JWTService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "authorization header required")
				return
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "authorization must be 'Bearer <token>'")
				return
			}

			claims, err := jwtSvc.Validate(tokenParts[1])
			if err != nil {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "invalid or expired token")
				return
			}

			ctx := context.WithValue(r.Context(), config.CtxKeyUserID, claims.UserID)
			ctx = context.WithValue(ctx, config.CtxKeyIsAdmin, claims.IsAdmin)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
