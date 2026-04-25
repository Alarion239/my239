// Package health provides liveness and readiness endpoints for platform
// probes (Railway, Kubernetes, Docker healthcheck).
package health

import (
	"context"
	"net/http"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Live returns 200 as long as the process is running. It must not depend on
// any downstream services — otherwise the orchestrator will kill the pod when
// the DB blips.
func Live() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// Ready reports whether the service can serve traffic right now. It pings the
// database with a short timeout; the orchestrator should use this to decide
// when to route traffic, not for liveness.
func Ready(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := database.Pool().Ping(ctx); err != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "unavailable",
				"reason": "database unreachable",
			})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
