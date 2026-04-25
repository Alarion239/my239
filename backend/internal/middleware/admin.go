package middleware

import (
	"net/http"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/httpx"
)

// AdminMiddleware gates routes that should only be visible to admins.
//
// It reads the is_admin flag set by AuthMiddleware from the request context;
// if missing or false, the request is rejected with 403. AuthMiddleware MUST
// run earlier in the chain — without it the context value is never set, and
// AdminMiddleware will (correctly) treat the request as non-admin.
//
// We trust the JWT claim rather than re-fetching the user on every request:
// access tokens are short-lived (15 min by default), so a demoted admin loses
// privileges within one TTL. If you need stricter semantics, layer a
// per-request DB check on top.
func AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isAdmin, _ := r.Context().Value(config.CtxKeyIsAdmin).(bool)
		if !isAdmin {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}
