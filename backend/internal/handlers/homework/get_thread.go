package homework

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// photoView is a single photo on an event. URL is a short-TTL presigned
// GET; ObjectKey is exposed too so the frontend can match user-visible
// images back to events without parsing URLs.
type photoView struct {
	Index       int    `json:"index"`
	ObjectKey   string `json:"object_key"`
	URL         string `json:"url"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

// eventView mirrors a homework_thread_event row plus its photos.
type eventView struct {
	ID              int64       `json:"id"`
	EventUUID       string      `json:"event_uuid"`
	Kind            string      `json:"kind"`
	ActorUserID     int64       `json:"actor_user_id"`
	Body            string      `json:"body"`
	Verdict         *string     `json:"verdict,omitempty"`
	RefersToEventID *int64      `json:"refers_to_event_id,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
	Photos          []photoView `json:"photos"`
	// IsOffline + CreditedGraderName describe an in-person accept/undo so the
	// timeline can render "Принято очно — Мария Кузнецова" for a grader who
	// may not be a registered user.
	IsOffline          bool   `json:"is_offline,omitempty"`
	CreditedGraderName string `json:"credited_grader_name,omitempty"`
}

// threadView is the full timeline + cache state for one thread. Used by
// student and grader detail views. seriesDueAt is included so the
// frontend can gate the submit form after the deadline without an extra
// round-trip; users is a flat map of every user_id that appears on the
// page (student, claim holder, last grader, every event actor) → display
// name, so the UI never has to render "пользователь #N".
type threadView struct {
	ID                int64             `json:"id"`
	StudentUserID     int64             `json:"student_user_id"`
	SubproblemID      int64             `json:"subproblem_id"`
	SeriesID          int64             `json:"series_id"`
	SeriesDueAt       time.Time         `json:"series_due_at"`
	MathCenterID      int64             `json:"math_center_id"`
	CurrentStatus     string            `json:"current_status"`
	LastGraderUserID  *int64            `json:"last_grader_user_id,omitempty"`
	LastGraderName    string            `json:"last_grader_name,omitempty"`
	ClaimHolderUserID *int64            `json:"claim_holder_user_id,omitempty"`
	ClaimExpiresAt    *time.Time        `json:"claim_expires_at,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
	Events            []eventView       `json:"events"`
	Users             map[string]string `json:"users"`
}

// GetThread — student owner, teacher of the center, or admin. Returns the
// thread's full event timeline with short-TTL presigned photo URLs.
func GetThread(database *db.DB, blobs objectstore.Store, downloadTTL time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, err := pathInt64(r, "threadID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid thread id")
			return
		}

		q := store.New(database.Pool())
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
				return
			}
			logger.LogErrorContext(ctx, "homework: get thread", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		allowed, err := canViewThread(ctx, r, q, userID, thread)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: thread auth", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if !allowed {
			httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "no access to this thread")
			return
		}

		view, err := buildThreadView(ctx, q, blobs, thread, downloadTTL)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: build thread view", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// canViewThread allows: the owning student, any teacher of the center, or
// an admin. Anyone else gets 403.
func canViewThread(ctx context.Context, r *http.Request, q *store.Queries, userID int64, thread store.HomeworkThread) (bool, error) {
	if thread.StudentUserID == userID {
		return true, nil
	}
	if callerIsAdmin(r) {
		return true, nil
	}
	return q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
		UserID: userID, MathCenterID: thread.MathCenterID,
	})
}

// buildThreadView joins events and their photos and signs each photo's GET
// URL with the configured download TTL. Photos are bucketed by event_id in
// Go so we only run two queries against the DB for the timeline. We also
// fetch the series row (for due_at) and the set of users that appear
// anywhere on the page (for display-name resolution).
func buildThreadView(ctx context.Context, q *store.Queries, blobs objectstore.Store, thread store.HomeworkThread, downloadTTL time.Duration) (*threadView, error) {
	series, err := q.GetSeries(ctx, thread.SeriesID)
	if err != nil {
		return nil, fmt.Errorf("get series: %w", err)
	}
	events, err := q.ListThreadEvents(ctx, thread.ID)
	if err != nil {
		return nil, fmt.Errorf("list thread events: %w", err)
	}
	users, err := loadUserNames(ctx, q, thread, events)
	if err != nil {
		return nil, fmt.Errorf("load user names: %w", err)
	}
	eventIDs := make([]int64, 0, len(events))
	for _, e := range events {
		eventIDs = append(eventIDs, e.ID)
	}
	photosByEvent := map[int64][]photoView{}
	if len(eventIDs) > 0 {
		rows, err := q.ListEventPhotosForEvents(ctx, eventIDs)
		if err != nil {
			return nil, fmt.Errorf("list event photos: %w", err)
		}
		for _, p := range rows {
			url, err := blobs.PresignGet(ctx, p.ObjectKey, downloadTTL)
			if err != nil {
				// If the object is gone (lifecycle expired, manual
				// delete, etc.) still surface the row — clients can
				// render a placeholder. Hide URL by leaving it empty.
				url = ""
			}
			photosByEvent[p.EventID] = append(photosByEvent[p.EventID], photoView{
				Index:       int(p.Idx),
				ObjectKey:   p.ObjectKey,
				URL:         url,
				ContentType: p.ContentType,
				SizeBytes:   p.SizeBytes,
			})
		}
	}
	evViews := make([]eventView, 0, len(events))
	for _, e := range events {
		photos := photosByEvent[e.ID]
		if photos == nil {
			photos = []photoView{}
		}
		evViews = append(evViews, eventView{
			ID:                 e.ID,
			EventUUID:          e.EventUuid,
			Kind:               e.Kind,
			ActorUserID:        e.ActorUserID,
			Body:               e.Body,
			Verdict:            e.Verdict,
			RefersToEventID:    e.RefersToEventID,
			CreatedAt:          e.CreatedAt,
			Photos:             photos,
			IsOffline:          e.IsOffline,
			CreditedGraderName: e.CreditedGraderName,
		})
	}
	return &threadView{
		ID:                thread.ID,
		StudentUserID:     thread.StudentUserID,
		SubproblemID:      thread.SubproblemID,
		SeriesID:          thread.SeriesID,
		SeriesDueAt:       series.DueAt,
		MathCenterID:      thread.MathCenterID,
		CurrentStatus:     thread.CurrentStatus,
		LastGraderUserID:  thread.LastGraderUserID,
		LastGraderName:    thread.LastGraderName,
		ClaimHolderUserID: thread.ClaimHolderUserID,
		ClaimExpiresAt:    thread.ClaimExpiresAt,
		CreatedAt:         thread.CreatedAt,
		UpdatedAt:         thread.UpdatedAt,
		Events:            evViews,
		Users:             users,
	}, nil
}

// loadUserNames bulk-fetches every user that appears on the thread page
// and returns a map[stringified-id]display-name. The student gets the
// "Имя Фамилия" form; everyone else (graders, retracters, etc.) gets
// the teacher "Имя Отчество" form. Map keys are strings because that's
// how JSON-marshalled Go maps land on the wire.
func loadUserNames(ctx context.Context, q *store.Queries, thread store.HomeworkThread, events []store.HomeworkThreadEvent) (map[string]string, error) {
	seen := map[int64]bool{thread.StudentUserID: true}
	ids := []int64{thread.StudentUserID}
	add := func(id *int64) {
		if id == nil || seen[*id] {
			return
		}
		seen[*id] = true
		ids = append(ids, *id)
	}
	add(thread.LastGraderUserID)
	add(thread.ClaimHolderUserID)
	for _, e := range events {
		if !seen[e.ActorUserID] {
			seen[e.ActorUserID] = true
			ids = append(ids, e.ActorUserID)
		}
	}
	rows, err := q.GetUsersByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("get users by ids: %w", err)
	}
	out := make(map[string]string, len(rows))
	for _, u := range rows {
		var name string
		if u.ID == thread.StudentUserID {
			name = mc.StudentDisplayName(u.FirstName, u.LastName)
		} else {
			name = mc.TeacherDisplayName(u.FirstName, u.MiddleName)
		}
		out[strconv.FormatInt(u.ID, 10)] = name
	}
	return out, nil
}

// writeThreadView fetches the (possibly just-updated) thread and writes it
// as the response. Used by submit/appeal/grade/retract so the client gets
// the post-mutation state in one round-trip.
func writeThreadView(ctx context.Context, w http.ResponseWriter, r *http.Request, database *db.DB, blobs objectstore.Store, threadID int64) {
	q := store.New(database.Pool())
	thread, err := q.GetThread(ctx, threadID)
	if err != nil {
		logger.LogErrorContext(ctx, "homework: get thread post-mutate", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return
	}
	// 1 minute is plenty for the immediate response render; clients
	// re-fetch via GetThread for fresh URLs if the user lingers.
	view, err := buildThreadView(ctx, q, blobs, thread, time.Minute)
	if err != nil {
		logger.LogErrorContext(ctx, "homework: build thread view post-mutate", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, view)
}
