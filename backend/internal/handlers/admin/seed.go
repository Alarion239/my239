package admin

import (
	"net/http"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/seed"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// SeedDemo resets and regenerates the demo dataset (a fictional center with
// groups, teachers, students, published series and homework submissions across
// every status) in one transaction. Admin-only (router middleware). Returns the
// summary + the shared demo password and login list.
func SeedDemo(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "admin: seed begin tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to seed demo data")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		result, err := seed.Run(ctx, tx)
		if err != nil {
			logger.LogErrorContext(ctx, "admin: seed run", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to seed demo data")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "admin: seed commit", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to seed demo data")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, result)
	}
}
