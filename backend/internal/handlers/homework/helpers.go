package homework

import (
	"context"
	"net/http"
	"strconv"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/go-chi/chi/v5"
)

// requireUser pulls the caller's user_id out of the request context. Returns
// (0, false) and writes a 401 envelope when AuthMiddleware didn't fire — this
// only happens in unit tests where the middleware was bypassed.
func requireUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	userID, err := ctxcache.UserID(r.Context())
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
		return 0, false
	}
	return userID, true
}

// pathInt64 parses a chi URL param as int64.
func pathInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, key), 10, 64)
}

// callerIsAdmin reads the is_admin claim set by AuthMiddleware. We trust the
// JWT here (15-min TTL is short enough that a demoted admin loses access
// quickly); same trade-off as middleware/admin.go.
func callerIsAdmin(r *http.Request) bool {
	v, _ := r.Context().Value(config.CtxKeyIsAdmin).(bool)
	return v
}

// requireTeacher enforces "caller teaches this center"; returns false and
// emits an error envelope if not. Used by every grader-facing handler.
func requireTeacher(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID int64) bool {
	isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "homework: teacher check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if !isTeacher {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a teacher of this center")
		return false
	}
	return true
}

// requireStudent enforces "caller is a student of this center"; returns
// false and emits an error envelope if not.
func requireStudent(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID int64) bool {
	isStudent, err := q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "homework: student check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if !isStudent {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a student of this center")
		return false
	}
	return true
}
