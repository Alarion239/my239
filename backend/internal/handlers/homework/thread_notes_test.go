package homework_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// Column lists matching the comments.sql SELECT/RETURNING order.
var threadNoteColumns = []string{
	"id", "thread_id", "author_user_id", "body", "created_at", "updated_at",
}

var threadNoteAuthoredColumns = []string{
	"id", "thread_id", "author_user_id", "author_first_name", "author_last_name",
	"body", "created_at", "updated_at",
}

// expectGetThread queues the GetThread lookup the note handlers make first.
func expectGetThread(mock pgxmock.PgxPoolIface, threadID, centerID int64, now time.Time) {
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(threadID).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(threadID, 7, 900, 100, centerID, threadRowOpts{Status: "submitted"}, now)...))
}

func TestCreateThreadNote_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectGetThread(mock, 1, 42, now)
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread_note`).
		WithArgs(int64(1), int64(3), "suspicious — identical to neighbour").
		WillReturnRows(mock.NewRows(threadNoteColumns).
			AddRow(int64(500), int64(1), int64(3), "suspicious — identical to neighbour", now, now))
	mock.ExpectQuery(`FROM homework_thread_note n\s+JOIN users u .* WHERE n.id`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows(threadNoteAuthoredColumns).
			AddRow(int64(500), int64(1), int64(3), "Пётр", "Учитель", "suspicious — identical to neighbour", now, now))

	body, _ := json.Marshal(map[string]any{"body": "suspicious — identical to neighbour"})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["author_name"] != "Пётр Учитель" {
		t.Errorf("author_name: got %v", got["author_name"])
	}
	if got["body"] != "suspicious — identical to neighbour" {
		t.Errorf("body: got %v", got["body"])
	}
}

func TestCreateThreadNote_RejectsEmptyBody(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	// Validation runs before any DB access, so no expectations are queued.
	body, _ := json.Marshal(map[string]any{"body": "   "})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestCreateThreadNote_RejectsNonTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectGetThread(mock, 1, 42, now)
	expectTeacherCheck(mock, 9, 42, false)

	body, _ := json.Marshal(map[string]any{"body": "note"})
	req := authedRequest(t, access, 9, false, http.MethodPost, "/threads/by-id/1/notes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestListThreadNotes_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	expectGetThread(mock, 1, 42, now)
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectQuery(`FROM homework_thread_note n\s+JOIN users u .* WHERE n.thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadNoteAuthoredColumns).
			AddRow(int64(500), int64(1), int64(3), "Пётр", "Учитель", "first", now, now).
			AddRow(int64(501), int64(1), int64(4), "Анна", "Грейдер", "second", now, now))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/threads/by-id/1/notes", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got) != 2 {
		t.Fatalf("notes: got %d, want 2", len(got))
	}
}

func TestUpdateThreadNote_RejectsNonAuthor(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	// The note was written by user 4; user 3 (a teacher, not the author) tries
	// to edit it.
	mock.ExpectQuery(`SELECT .* FROM homework_thread_note\s+WHERE id`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows(threadNoteColumns).
			AddRow(int64(500), int64(1), int64(4), "original", now, now))
	expectGetThread(mock, 1, 42, now)
	expectTeacherCheck(mock, 3, 42, true)

	body, _ := json.Marshal(map[string]any{"body": "rewrite"})
	req := authedRequest(t, access, 3, false, http.MethodPatch, "/threads/by-id/1/notes/500", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestDeleteThreadNote_AuthorSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)
	now := time.Now()

	mock.ExpectQuery(`SELECT .* FROM homework_thread_note\s+WHERE id`).
		WithArgs(int64(500)).
		WillReturnRows(mock.NewRows(threadNoteColumns).
			AddRow(int64(500), int64(1), int64(3), "mine", now, now))
	expectGetThread(mock, 1, 42, now)
	expectTeacherCheck(mock, 3, 42, true)
	mock.ExpectExec(`DELETE FROM homework_thread_note WHERE id`).
		WithArgs(int64(500)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	req := authedRequest(t, access, 3, false, http.MethodDelete, "/threads/by-id/1/notes/500", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
}
