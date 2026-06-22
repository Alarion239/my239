package mathcenter

import (
	"fmt"
	"net/http"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

const sseHeartbeat = 25 * time.Second

// Events streams center-change signals (text/event-stream). The client uses
// each event's `kind` to invalidate the matching React Query keys and refetch
// via the normal GET endpoints — we never stream domain data here. Gated by the
// router's auth/impersonation middleware plus a center-access check (admin OR
// teacher OR student of the center).
func Events(hub *live.Hub, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		centerID, err := pathInt64(r, "centerID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
			return
		}
		q := store.New(database.Pool())
		isTeacher, isStudent, err := membership(ctx, r, q, userID, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "events: membership", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !isTeacher && !isStudent {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this center")
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "streaming unsupported")
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx proxy buffering
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, ": connected\n\n")
		flusher.Flush()

		sub := hub.Subscribe(centerID)
		defer hub.Unsubscribe(sub)

		ping := time.NewTicker(sseHeartbeat)
		defer ping.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ping.C:
				if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
					return
				}
				flusher.Flush()
			case ev := <-sub.C:
				if _, err := fmt.Fprintf(w, "event: %s\ndata: {\"center_id\":%d,\"kind\":%q,\"series_id\":%d}\n\n",
					ev.Kind, ev.CenterID, ev.Kind, ev.SeriesID); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}
