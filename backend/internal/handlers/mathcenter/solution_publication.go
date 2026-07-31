package mathcenter

import (
	"net/http"
	"sort"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type publishSolutionsRequest struct {
	SubproblemIDs []int64 `json:"subproblem_ids"`
}

type publishSolutionsResponse struct {
	SubproblemIDs     []int64 `json:"subproblem_ids"`
	PublishedAt       string  `json:"published_at"`
	ReleasedCoffinIDs []int64 `json:"released_coffin_ids"`
}

// PublishSubproblemSolutions publishes one shared razbor atomically. Draft
// material writes never release coffins; this endpoint is the sole transition
// which sets published_at and releases coffin submissions.
func PublishSubproblemSolutions(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		var req publishSolutionsRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		ids := uniquePositiveIDs(req.SubproblemIDs)
		if len(ids) == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "subproblem_ids required")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "razbor publish: begin", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)
		targets, err := q.LockSolutionPublicationTargets(ctx, ids)
		if err != nil {
			logger.LogErrorContext(ctx, "razbor publish: lock targets", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if len(targets) != len(ids) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "one or more subproblems not found")
			return
		}
		centerID, seriesID := targets[0].MathCenterID, targets[0].SeriesID
		for _, target := range targets {
			if target.MathCenterID != centerID || target.SeriesID != seriesID {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "subproblems must belong to one center and series")
				return
			}
			if !target.HasMaterial {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "every subproblem needs at least one saved разбор format")
				return
			}
		}
		if !requireTeacher(ctx, w, r, q, userID, centerID) {
			return
		}

		// Keep an existing shared group when all targets already point at the
		// same group. Otherwise mint one group and apply it to the whole set.
		groupID, sameGroup := int64(0), true
		for i, target := range targets {
			if target.GroupID == nil {
				sameGroup = false
				break
			}
			if i == 0 {
				groupID = *target.GroupID
			} else if *target.GroupID != groupID {
				sameGroup = false
				break
			}
		}
		if !sameGroup {
			groupID, err = q.CreateSolutionGroup(ctx)
			if err != nil {
				logger.LogErrorContext(ctx, "razbor publish: create group", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
			if err := q.SetSubproblemSolutionGroup(ctx, store.SetSubproblemSolutionGroupParams{GroupID: groupID, SubproblemIds: ids}); err != nil {
				logger.LogErrorContext(ctx, "razbor publish: set group", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
		}

		publishedAt := time.Now().UTC()
		results, err := q.PublishSolutions(ctx, ids, publishedAt)
		if err != nil {
			logger.LogErrorContext(ctx, "razbor publish: update", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if len(results) != len(ids) {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "publication targets changed; retry")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "razbor publish: commit", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		released := make([]int64, 0, len(results))
		for _, result := range results {
			if result.IsCoffin {
				released = append(released, result.SubproblemID)
			}
		}
		sort.Slice(released, func(i, j int) bool { return released[i] < released[j] })
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindCoffins})
		httpx.WriteJSON(w, http.StatusOK, publishSolutionsResponse{
			SubproblemIDs: ids, PublishedAt: publishedAt.Format(time.RFC3339Nano), ReleasedCoffinIDs: released,
		})
	}
}

func uniquePositiveIDs(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
