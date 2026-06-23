package homework

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// threadNoteView is the wire shape for one internal note on a solution thread.
// The body is teacher-only and is NEVER included in the student-visible
// ThreadView; it surfaces only through these requireTeacher endpoints.
type threadNoteView struct {
	ID           int64     `json:"id"`
	AuthorUserID int64     `json:"author_user_id"`
	AuthorName   string    `json:"author_name"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// noteBodyRequest is the body of create/update for both note resources.
type noteBodyRequest struct {
	Body string `json:"body"`
}

// validateNoteBody trims + length-checks a note body, rejecting empty.
func validateNoteBody(raw string) (string, string) {
	body, err := homework.ValidateBody(raw)
	if err != nil {
		return "", err.Error()
	}
	if body == "" {
		return "", "comment body is required"
	}
	return body, ""
}

// ListThreadNotes — teacher of the thread's center. Returns the internal notes
// on a solution thread, oldest first.
func ListThreadNotes(database *db.DB) http.HandlerFunc {
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
		thread, ok := loadThreadForNotes(ctx, w, r, q, threadID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}
		rows, err := q.ListThreadNotesAuthored(ctx, threadID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: list thread notes", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		out := make([]threadNoteView, 0, len(rows))
		for _, n := range rows {
			out = append(out, threadNoteView{
				ID:           n.ID,
				AuthorUserID: n.AuthorUserID,
				AuthorName:   mc.StudentDisplayName(n.AuthorFirstName, n.AuthorLastName),
				Body:         n.Body,
				CreatedAt:    n.CreatedAt,
				UpdatedAt:    n.UpdatedAt,
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// CreateThreadNote — teacher of the thread's center appends an internal note.
func CreateThreadNote(database *db.DB) http.HandlerFunc {
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
		var req noteBodyRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		body, vErr := validateNoteBody(req.Body)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}
		q := store.New(database.Pool())
		thread, ok := loadThreadForNotes(ctx, w, r, q, threadID)
		if !ok {
			return
		}
		if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
			return
		}
		note, err := q.CreateThreadNote(ctx, store.CreateThreadNoteParams{
			ThreadID:     threadID,
			AuthorUserID: userID,
			Body:         body,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: create thread note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save comment")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: thread.MathCenterID, Kind: live.KindComments, SeriesID: thread.SeriesID})
		writeThreadNoteView(ctx, w, r, q, note.ID, http.StatusCreated)
	}
}

// UpdateThreadNote — the note's author (or an admin) edits its body.
func UpdateThreadNote(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, noteID, ok := threadAndNoteIDs(w, r)
		if !ok {
			return
		}
		var req noteBodyRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		body, vErr := validateNoteBody(req.Body)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}
		q := store.New(database.Pool())
		thread, ok := authorizeThreadNoteWrite(ctx, w, r, q, userID, threadID, noteID)
		if !ok {
			return
		}
		affected, err := q.UpdateThreadNote(ctx, store.UpdateThreadNoteParams{ID: noteID, Body: body})
		if err != nil {
			logger.LogErrorContext(ctx, "homework: update thread note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update comment")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: thread.MathCenterID, Kind: live.KindComments, SeriesID: thread.SeriesID})
		writeThreadNoteView(ctx, w, r, q, noteID, http.StatusOK)
	}
}

// DeleteThreadNote — the note's author (or an admin) deletes it.
func DeleteThreadNote(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		threadID, noteID, ok := threadAndNoteIDs(w, r)
		if !ok {
			return
		}
		q := store.New(database.Pool())
		thread, ok := authorizeThreadNoteWrite(ctx, w, r, q, userID, threadID, noteID)
		if !ok {
			return
		}
		affected, err := q.DeleteThreadNote(ctx, noteID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: delete thread note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete comment")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: thread.MathCenterID, Kind: live.KindComments, SeriesID: thread.SeriesID})
		w.WriteHeader(http.StatusNoContent)
	}
}

// loadThreadForNotes fetches the thread, translating "no rows" into a 404.
func loadThreadForNotes(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, threadID int64) (store.HomeworkThread, bool) {
	thread, err := q.GetThread(ctx, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "thread not found")
			return store.HomeworkThread{}, false
		}
		logger.LogErrorContext(ctx, "homework: get thread for notes", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.HomeworkThread{}, false
	}
	return thread, true
}

// threadAndNoteIDs parses both path ids.
func threadAndNoteIDs(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	threadID, err := pathInt64(r, "threadID")
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid thread id")
		return 0, 0, false
	}
	noteID, err := pathInt64(r, "noteID")
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid note id")
		return 0, 0, false
	}
	return threadID, noteID, true
}

// authorizeThreadNoteWrite loads the note + its thread and enforces: the note
// belongs to the path thread, the caller teaches the center, and the caller is
// the note's author (or an admin). Returns the thread for the live publish.
func authorizeThreadNoteWrite(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, threadID, noteID int64) (store.HomeworkThread, bool) {
	note, err := q.GetThreadNote(ctx, noteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return store.HomeworkThread{}, false
		}
		logger.LogErrorContext(ctx, "homework: get thread note", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.HomeworkThread{}, false
	}
	if note.ThreadID != threadID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
		return store.HomeworkThread{}, false
	}
	thread, ok := loadThreadForNotes(ctx, w, r, q, note.ThreadID)
	if !ok {
		return store.HomeworkThread{}, false
	}
	if !requireTeacher(ctx, w, r, q, userID, thread.MathCenterID) {
		return store.HomeworkThread{}, false
	}
	if !callerIsAdmin(r) && note.AuthorUserID != userID {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "only the comment's author can edit or delete it")
		return store.HomeworkThread{}, false
	}
	return thread, true
}

// writeThreadNoteView fetches the authored view of one note and writes it.
func writeThreadNoteView(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, noteID int64, status int) {
	n, err := q.GetThreadNoteAuthored(ctx, noteID)
	if err != nil {
		logger.LogErrorContext(ctx, "homework: get thread note view", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return
	}
	httpx.WriteJSON(w, status, threadNoteView{
		ID:           n.ID,
		AuthorUserID: n.AuthorUserID,
		AuthorName:   mc.StudentDisplayName(n.AuthorFirstName, n.AuthorLastName),
		Body:         n.Body,
		CreatedAt:    n.CreatedAt,
		UpdatedAt:    n.UpdatedAt,
	})
}
