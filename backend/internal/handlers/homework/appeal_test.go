package homework_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func TestAppeal_OnlyAllowedAfterRejection(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		status     string
		wantStatus int
	}{
		{"from ungraded blocks", "ungraded", http.StatusConflict},
		{"from submitted blocks", "submitted", http.StatusConflict},
		{"from accepted blocks", "accepted", http.StatusConflict},
		{"from appealed blocks", "appealed", http.StatusConflict},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mock, _ := pgxmock.NewPool()
			defer mock.Close()
			r, access, _ := newRouter(t, mock)

			now := time.Now()
			expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
			expectStudentCheck(mock, 7, 42, true)
			mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE student_user_id`).
				WithArgs(int64(7), int64(900)).
				WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: c.status}, now)...))

			body, _ := json.Marshal(map[string]any{"event_uuid": "u", "body": "please", "object_keys": []string{}})
			req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/appeal", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != c.wantStatus {
				t.Errorf("status=%s: got %d, want %d", c.status, rr.Code, c.wantStatus)
			}
		})
	}
}

func TestAppeal_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	gradeID := int64(41)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE student_user_id`).
		WithArgs(int64(7), int64(900)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "rejected", GradeEventID: &gradeID,
		}, now)...))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), "u", "appealed", int64(7), "please regrade", (*string)(nil), &gradeID).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(70), int64(1), "u", "appealed", int64(7), "please regrade", (*string)(nil), &gradeID, now))
	newAttempt := int64(70)
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'appealed'`).
		WithArgs(int64(1), &newAttempt).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(threadRow(1, 7, 900, 100, 42, threadRowOpts{
			Status: "appealed", AttemptEventID: &newAttempt, GradeEventID: &gradeID,
		}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{
		"event_uuid": "u", "body": "please regrade", "object_keys": []string{},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/appeal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestAppeal_NoThreadYet(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &now)
	expectStudentCheck(mock, 7, 42, true)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE student_user_id`).
		WithArgs(int64(7), int64(900)).
		WillReturnError(pgx.ErrNoRows)

	body, _ := json.Marshal(map[string]any{"event_uuid": "u", "body": "x", "object_keys": []string{}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/appeal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", rr.Code)
	}
}
