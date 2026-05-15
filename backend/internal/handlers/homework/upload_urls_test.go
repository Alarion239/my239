package homework_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestIssueStudentUploadURLs_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	pub := now.Add(-time.Hour)
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &pub)
	expectStudentCheck(mock, 7, 42, true)
	// FindOrCreateThread upsert returns the row.
	mock.ExpectQuery(`INSERT INTO homework_thread`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(1, 7, 900, 100, 42, now)...))

	body, _ := json.Marshal(map[string]any{
		"content_types": []string{"image/jpeg", "image/png"},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		EventUUID string `json:"event_uuid"`
		Slots     []struct {
			Index       int    `json:"index"`
			ObjectKey   string `json:"object_key"`
			UploadURL   string `json:"upload_url"`
			ContentType string `json:"content_type"`
		} `json:"slots"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.Slots) != 2 {
		t.Fatalf("want 2 slots, got %d", len(resp.Slots))
	}
	prefix := "homework/thread/1/" + resp.EventUUID + "/"
	for _, s := range resp.Slots {
		if !strings.HasPrefix(s.ObjectKey, prefix) {
			t.Errorf("slot key %q outside event prefix %q", s.ObjectKey, prefix)
		}
		if !strings.HasPrefix(s.UploadURL, "memory://put/") {
			t.Errorf("slot URL not memory://put/: %q", s.UploadURL)
		}
	}
	if resp.Slots[0].ObjectKey == resp.Slots[1].ObjectKey {
		t.Error("two slots got the same key")
	}
}

func TestIssueStudentUploadURLs_RejectsBadMIME(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	body, _ := json.Marshal(map[string]any{
		"content_types": []string{"image/gif"},
	})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (bad mime)", rr.Code)
	}
}

func TestIssueStudentUploadURLs_RejectsTooMany(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	cts := make([]string, 11)
	for i := range cts {
		cts[i] = "image/jpeg"
	}
	body, _ := json.Marshal(map[string]any{"content_types": cts})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (too many)", rr.Code)
	}
}

func TestIssueStudentUploadURLs_NotStudentForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	pub := now
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "a", now.Add(time.Hour), &pub)
	expectStudentCheck(mock, 7, 42, false)

	body, _ := json.Marshal(map[string]any{"content_types": []string{"image/jpeg"}})
	req := authedRequest(t, access, 7, false, http.MethodPost, "/threads/900/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestIssueGraderUploadURLs_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(5)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(5, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, true)

	body, _ := json.Marshal(map[string]any{"content_types": []string{"image/png"}})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/5/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestIssueGraderUploadURLs_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(5)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(emptyThreadRow(5, 7, 900, 100, 42, now)...))
	expectTeacherCheck(mock, 3, 42, false)

	body, _ := json.Marshal(map[string]any{"content_types": []string{"image/png"}})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/threads/by-id/5/upload-urls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
