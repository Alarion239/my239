package middleware

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// actAsHeader is the request header an admin sets to act as another user. Its
// value is the target user's int64 ID.
const actAsHeader = "X-Act-As-User-Id"

// ImpersonationMiddleware lets an admin act as any user for the request it
// wraps. It MUST run AFTER AuthMiddleware, which sets CtxKeyUserID and
// CtxKeyIsAdmin from the JWT (the REAL caller).
//
// When a real admin sends the X-Act-As-User-Id header, the middleware looks up
// the target user and OVERWRITES the effective identity on the context with the
// target's ID and admin flag, while preserving the real identity under
// CtxKeyRealUserID / CtxKeyRealIsAdmin. Every downstream ownership and role
// check (requireTeacher, requireStudent, /me) then acts faithfully as the
// impersonated user — so impersonating a non-admin deliberately does NOT carry
// the admin teacher-superset. The header is ignored for non-admin callers and
// when absent. Each applied impersonation emits one structured audit line,
// centralizing the audit so individual write handlers need no change.
func ImpersonationMiddleware(database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			actAs := r.Header.Get(actAsHeader)
			if actAs == "" {
				next.ServeHTTP(w, r)
				return
			}

			realUserID, _ := ctx.Value(config.CtxKeyUserID).(int64)
			realIsAdmin, _ := ctx.Value(config.CtxKeyIsAdmin).(bool)

			// Only admins may impersonate. Silently ignore the header for
			// everyone else so a forged header is a no-op, not an error.
			if !realIsAdmin {
				logger.LogDebug("ignoring act-as header from non-admin caller",
					"real_user_id", realUserID, "path", r.URL.Path)
				next.ServeHTTP(w, r)
				return
			}

			targetID, err := strconv.ParseInt(actAs, 10, 64)
			if err != nil {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "act-as target user not found")
				return
			}

			target, err := store.New(database.Pool()).GetUserByID(ctx, targetID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "act-as target user not found")
					return
				}
				logger.LogErrorContext(ctx, "impersonation: look up act-as target", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}

			// Stash the real identity, then overwrite the effective identity
			// with the target's. From here every check acts as the target.
			ctx = context.WithValue(ctx, config.CtxKeyRealUserID, realUserID)
			ctx = context.WithValue(ctx, config.CtxKeyRealIsAdmin, realIsAdmin)
			ctx = context.WithValue(ctx, config.CtxKeyUserID, target.ID)
			ctx = context.WithValue(ctx, config.CtxKeyIsAdmin, target.IsAdmin)

			logger.LogInfoContext(ctx, "act-as impersonation",
				"real_user_id", realUserID,
				"acting_as", target.ID,
				"method", r.Method,
				"path", r.URL.Path,
			)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
