package homework_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestSubmit_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	pub := now.Add(-time.Hour)

	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", due, &pub)
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	// Seed photos in the bucket so Stat returns size+type.
	eventUUID := "abc123"
	key0 := "homework/thread/1/" + eventUUID + "/0.jpg"
	_ = blobs.Put(context.Background(), key0, strings.NewReader("img-body"), 8, "image/jpeg")

	// Tx: AppendEvent → InsertEventPhoto → UpdateThreadAfterSubmit → Commit
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), eventUUID, "submitted", int64(7), "my solution", (*string)(nil), (*int64)(nil)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(50), int64(1), eventUUID, "submitted", int64(7), "my solution", (*string)(nil), (*int64)(nil), now, false, (*int64)(nil), ""))
	mock.ExpectExec(`INSERT INTO homework_thread_event_photo`).
		WithArgs(int64(50), int32(0), key0, int64(8), "image/jpeg").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	evID := int64(50)
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'submitted'`).
		WithArgs(int64(1), &evID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	// Post-mutation view fetch: GetThread → ListThreadEvents → ListEventPhotosForEvents
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &evID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(50), int64(1), eventUUID, "submitted", int64(7), "my solution", (*string)(nil), (*int64)(nil), now, false, (*int64)(nil), ""))
	expectGetUsersForView(mock)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event_photo`).
		WithArgs([]int64{50}).
		WillReturnRows(mock.NewRows([]string{"event_id", "idx", "object_key", "size_bytes", "content_type", "created_at"}).
			AddRow(int64(50), int32(0), key0, int64(8), "image/jpeg", now))

	body, _ := json.Marshal(map[string]any{
		"event_uuid":  eventUUID,
		"body":        "my solution",
		"object_keys": []string{key0},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestSubmit_AfterDueBlocks(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(-time.Hour) // already past due
	pub := now.Add(-2 * time.Hour)
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", due, &pub)
	expectStudentCheck(mock, 7, 42, true)

	body, _ := json.Marshal(map[string]any{
		"event_uuid":  "abc",
		"body":        "late",
		"object_keys": []string{},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409 (submissions closed)", rr.Code)
	}
}

// TestSubmit_ReleasedCoffinBlocks: a coffin whose solution has been released is
// closed for submission even though it's a coffin.
func TestSubmit_ReleasedCoffinBlocks(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(-48 * time.Hour) // long past due
	pub := now.Add(-72 * time.Hour)
	released := now.Add(-time.Hour) // coffin solution already out
	expectSubproblemContextCoffin(mock, 900, 500, 100, 42, 1, "a", due, &pub, &released)
	expectStudentCheck(mock, 7, 42, true)

	body, _ := json.Marshal(map[string]any{"event_uuid": "abc", "body": "late", "object_keys": []string{}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409 (released coffin closed)", rr.Code)
	}
}

// TestSubmit_OpenCoffinAllowsLateSubmit: a coffin with no release date stays
// open for submission past the series deadline.
func TestSubmit_OpenCoffinAllowsLateSubmit(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(-48 * time.Hour) // past due, but...
	pub := now.Add(-72 * time.Hour)
	expectSubproblemContextCoffin(mock, 900, 500, 100, 42, 1, "a", due, &pub, nil) // ...open coffin
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	eventUUID := "coffin-late"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), eventUUID, "submitted", int64(7), "late coffin try", (*string)(nil), (*int64)(nil)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(50), int64(1), eventUUID, "submitted", int64(7), "late coffin try", (*string)(nil), (*int64)(nil), now, false, (*int64)(nil), ""))
	evID := int64(50)
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'submitted'`).
		WithArgs(int64(1), &evID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	// Post-mutation view fetch.
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &evID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(50), int64(1), eventUUID, "submitted", int64(7), "late coffin try", (*string)(nil), (*int64)(nil), now, false, (*int64)(nil), ""))
	expectGetUsersForView(mock)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event_photo`).
		WithArgs([]int64{50}).
		WillReturnRows(mock.NewRows([]string{"event_id", "idx", "object_key", "size_bytes", "content_type", "created_at"}))

	body, _ := json.Marshal(map[string]any{"event_uuid": eventUUID, "body": "late coffin try", "object_keys": []string{}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 (open coffin accepts late submit); body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestSubmit_NotStudentForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, false)

	body, _ := json.Marshal(map[string]any{"event_uuid": "abc", "body": "x", "object_keys": []string{}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestSubmit_RejectsForeignObjectKey(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	body, _ := json.Marshal(map[string]any{
		"event_uuid":  "abc",
		"body":        "x",
		"object_keys": []string{"homework/thread/999/foreign/0.jpg"},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (foreign key); body=%s", rr.Code, rr.Body.String())
	}
}

func TestSubmit_RejectsMissingObject(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	body, _ := json.Marshal(map[string]any{
		"event_uuid":  "abc",
		"body":        "x",
		"object_keys": []string{"homework/thread/1/abc/0.jpg"}, // never uploaded
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (missing object); body=%s", rr.Code, rr.Body.String())
	}
}

func TestSubmit_RejectsWrongContentType(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	// Seed object with wrong content-type.
	key := "homework/thread/1/abc/0.jpg"
	_ = blobs.Put(context.Background(), key, strings.NewReader("not an image"), 12, "application/pdf")

	body, _ := json.Marshal(map[string]any{
		"event_uuid":  "abc",
		"body":        "x",
		"object_keys": []string{key},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (wrong ct); body=%s", rr.Code, rr.Body.String())
	}
}

func TestSubmit_BlockedOnSubmittedStatus(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	// FindOrCreateThread returns a thread already in 'submitted' state.
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: "submitted"}, now)...))

	body, _ := json.Marshal(map[string]any{"event_uuid": "abc", "body": "x", "object_keys": []string{}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409 (illegal transition)", rr.Code)
	}
}

func TestSubmit_AllowedAfterRejection(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	// Thread is in 'rejected' — resubmission must be allowed.
	prevEv := int64(40)
	prevGrade := int64(41)
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", AttemptEventID: &prevEv, GradeEventID: &prevGrade,
		}, now)...))

	// Empty photos OK — resubmission with text-only body.
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "uuid2", "submitted", int64(7), "fixed it", (*string)(nil), (*int64)(nil)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(60), int64(1), "uuid2", "submitted", int64(7), "fixed it", (*string)(nil), (*int64)(nil), now, false, (*int64)(nil), ""))
	newAttempt := int64(60)
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'submitted'`).
		WithArgs(int64(1), &newAttempt).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	// view fetch
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &newAttempt,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"event_uuid": "uuid2", "body": "fixed it", "object_keys": []string{},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}
