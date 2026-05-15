package homework_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestGetThread_StudentOwnerAllowed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	// Owner is user 7, so no teacher check.
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns).
			AddRow(int64(50), int64(1), "u", "submitted", int64(7), "hi", (*string)(nil), (*int64)(nil), now))
	expectGetUsersForView(mock)
	key := "homework/thread/1/u/0.jpg"
	_ = blobs.Put(t.Context(), key, strings.NewReader("img"), 3, "image/jpeg")
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event_photo`).
		WithArgs([]int64{50}).
		WillReturnRows(mock.NewRows([]string{"event_id", "idx", "object_key", "size_bytes", "content_type", "created_at"}).
			AddRow(int64(50), int32(0), key, int64(3), "image/jpeg", now))

	req := authedRequest(t, access, 7, false, http.MethodGet, "/threads/by-id/1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var v struct {
		Events []struct {
			Kind   string `json:"kind"`
			Photos []struct {
				URL string `json:"url"`
			} `json:"photos"`
		} `json:"events"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &v)
	if len(v.Events) != 1 {
		t.Fatalf("want 1 event, got %d", len(v.Events))
	}
	if len(v.Events[0].Photos) != 1 || v.Events[0].Photos[0].URL == "" {
		t.Errorf("photo URL missing: %+v", v.Events[0].Photos)
	}
}

func TestGetThread_TeacherOfCenterAllowed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	req := authedRequest(t, access, 3, false, http.MethodGet, "/threads/by-id/1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetThread_AdminAllowed(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	req := authedRequest(t, access, 99, true /* admin */, http.MethodGet, "/threads/by-id/1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("got %d, want 200 (admin); body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetThread_OutsiderForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 88, 42, false)

	req := authedRequest(t, access, 88, false, http.MethodGet, "/threads/by-id/1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

