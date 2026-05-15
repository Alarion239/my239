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

func TestGrade_HappyPathAccept(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	verdict := "accepted"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "g1", "graded", int64(3), "great work", &verdict, &attemptID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(80), int64(1), "g1", "graded", int64(3), "great work", &verdict, &attemptID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= CASE`).
		WithArgs("accepted", int64(80), int64(3), int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	// view fetch
	gradeID := int64(80)
	graderID := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "accepted", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &graderID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "great work", "event_uuid": "g1", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_RejectVerdictAlsoWorks(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	verdict := "rejected"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "g2", "graded", int64(3), "see step 3", &verdict, &attemptID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(81), int64(1), "g2", "graded", int64(3), "see step 3", &verdict, &attemptID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= CASE`).
		WithArgs("rejected", int64(81), int64(3), int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	gradeID := int64(81)
	graderID := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &graderID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"verdict": "rejected", "body": "see step 3", "event_uuid": "g2", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_ClaimContention(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	verdict := "accepted"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "g3", "graded", int64(3), "ok", &verdict, &attemptID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(82), int64(1), "g3", "graded", int64(3), "ok", &verdict, &attemptID, now))
	// UpdateThreadAfterGrade affects 0 rows — claim was stolen.
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= CASE`).
		WithArgs("accepted", int64(82), int64(3), int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectRollback()

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "ok", "event_uuid": "g3", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_AppealedRoutesToOriginalGrader(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(70)
	originalGrader := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "appealed", AttemptEventID: &attemptID, LastGraderID: &originalGrader,
		}, now)...))
	// Different teacher (user 4) tries to grade — they're a teacher of
	// the center but NOT the original grader.
	expectTeacherCheck(mock, 4, 42, true)

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "ok", "event_uuid": "g4", "object_keys": []string{},
	})
	req := authedRequest(t, access, 4, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_AdminCanOverrideAppealStickiness(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(70)
	originalGrader := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "appealed", AttemptEventID: &attemptID, LastGraderID: &originalGrader,
		}, now)...))
	expectTeacherCheck(mock, 4, 42, true)

	verdict := "accepted"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "g5", "graded", int64(4), "admin override", &verdict, &attemptID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(90), int64(1), "g5", "graded", int64(4), "admin override", &verdict, &attemptID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= CASE`).
		WithArgs("accepted", int64(90), int64(4), int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	gradeID := int64(90)
	graderID := int64(4)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "accepted", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &graderID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "admin override", "event_uuid": "g5", "object_keys": []string{},
	})
	req := authedRequest(t, access, 4, true /* isAdmin */, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 (admin overrides); body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_RejectsEmptyBody(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "   ", "event_uuid": "g", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (empty body)", rr.Code)
	}
}

func TestGrade_RejectsInvalidVerdict(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	body, _ := json.Marshal(map[string]any{
		"verdict": "maybe", "body": "ok", "event_uuid": "g", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (invalid verdict)", rr.Code)
	}
}

func TestGrade_HappyPathWithPhoto(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	// Seed a photo at the canonical prefix.
	key := "homework/thread/1/g6/0.png"
	_ = blobs.Put(context.Background(), key, strings.NewReader("annot"), 5, "image/png")

	verdict := "rejected"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "g6", "graded", int64(3), "annotated", &verdict, &attemptID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(83), int64(1), "g6", "graded", int64(3), "annotated", &verdict, &attemptID, now))
	mock.ExpectExec(`INSERT INTO homework_thread_event_photo`).
		WithArgs(int64(83), int32(0), key, int64(5), "image/png").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= CASE`).
		WithArgs("rejected", int64(83), int64(3), int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	gradeID := int64(83)
	graderID := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &graderID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"verdict":     "rejected",
		"body":        "annotated",
		"event_uuid":  "g6",
		"object_keys": []string{key},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGrade_RejectsWhenAcceptedAlready(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "accepted",
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	body, _ := json.Marshal(map[string]any{
		"verdict": "accepted", "body": "x", "event_uuid": "g7", "object_keys": []string{},
	})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/grade", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409 (illegal transition); body=%s", rr.Code, rr.Body.String())
	}
}
