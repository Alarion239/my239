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

func TestRetract_OwnGraderRollsBackToSubmitted(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	gradeID := int64(80)
	grader := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &grader,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	// Most-recent graded event.
	verdict := "rejected"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id = \$1\s+AND kind\s+= 'graded'`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(80), int64(1), "g1", "graded", int64(3), "see step 3", &verdict, &attemptID, now))
	// rollbackStatus reads the kind of the current attempt event (50).
	mock.ExpectQuery(`SELECT kind FROM homework_thread_event\s+WHERE id`).
		WithArgs(int64(50)).
		WillReturnRows(mock.NewRows([]string{"kind"}).AddRow("submitted"))

	// Tx: AppendEvent('retracted', refers_to=80) → UpdateThreadAfterRetract.
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), pgxmock.AnyArg(), "retracted", int64(3), "my mistake", (*string)(nil), &gradeID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(85), int64(1), "rev1", "retracted", int64(3), "my mistake", (*string)(nil), &gradeID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= \$2`).
		WithArgs(int64(1), "submitted").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	// view fetch
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID, LastGraderID: &grader,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{"body": "my mistake"})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/retract", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestRetract_RollbackAfterAppealGoesToAppealed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	appealEv := int64(70)
	gradeID := int64(85)
	grader := int64(3)
	// Thread is accepted post-appeal; current attempt event was an appeal.
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "accepted", AttemptEventID: &appealEv, GradeEventID: &gradeID, LastGraderID: &grader,
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	verdict := "accepted"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id = \$1\s+AND kind\s+= 'graded'`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(85), int64(1), "g2", "graded", int64(3), "ok actually no", &verdict, &appealEv, now))
	mock.ExpectQuery(`SELECT kind FROM homework_thread_event\s+WHERE id`).
		WithArgs(int64(70)).
		WillReturnRows(mock.NewRows([]string{"kind"}).AddRow("appealed"))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), pgxmock.AnyArg(), "retracted", int64(3), "", (*string)(nil), &gradeID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(95), int64(1), "rev2", "retracted", int64(3), "", (*string)(nil), &gradeID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= \$2`).
		WithArgs(int64(1), "appealed").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "appealed", AttemptEventID: &appealEv, LastGraderID: &grader,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/1/retract", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestRetract_OtherGraderForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	originalGrader := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "accepted", LastGraderID: &originalGrader,
		}, now)...))
	expectTeacherCheck(mock, 4, 42, true) // user 4 is a teacher, but not the original grader

	req := authedRequest(t, access, 4, false, http.MethodPost, "/threads/by-id/1/retract", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestRetract_AdminCanRetract(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	attemptID := int64(50)
	gradeID := int64(80)
	originalGrader := int64(3)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", AttemptEventID: &attemptID, GradeEventID: &gradeID, LastGraderID: &originalGrader,
		}, now)...))
	expectTeacherCheck(mock, 4, 42, true)
	verdict := "rejected"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id = \$1\s+AND kind\s+= 'graded'`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(80), int64(1), "g", "graded", int64(3), "x", &verdict, &attemptID, now))
	mock.ExpectQuery(`SELECT kind FROM homework_thread_event\s+WHERE id`).
		WithArgs(int64(50)).
		WillReturnRows(mock.NewRows([]string{"kind"}).AddRow("submitted"))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), pgxmock.AnyArg(), "retracted", int64(4), "policy override", (*string)(nil), &gradeID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(95), int64(1), "rev", "retracted", int64(4), "policy override", (*string)(nil), &gradeID, now))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= \$2`).
		WithArgs(int64(1), "submitted").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", AttemptEventID: &attemptID, LastGraderID: &originalGrader,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{"body": "policy override"})
	req := authedRequest(t, access, 4, true, http.MethodPost, "/threads/by-id/1/retract", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 (admin); body=%s", rr.Code, rr.Body.String())
	}
}

func TestRetract_RejectsBeforeVerdict(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "submitted", // no verdict to retract
		}, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	req := authedRequest(t, access, 3, true /* admin to skip grader stickiness */, http.MethodPost, "/threads/by-id/1/retract", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
}
