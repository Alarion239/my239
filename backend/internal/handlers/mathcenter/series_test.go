package mathcenter_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	mcHandlers "github.com/Alarion239/my239/backend/internal/handlers/mathcenter"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// seriesColumns matches `SELECT * FROM math_center_series` after sqlc.
var seriesColumns = []string{
	"id", "math_center_id", "number", "name", "due_at",
	"pdf_object_key", "published_at", "created_at",
}

var problemColumns = []string{"id", "series_id", "number", "created_at"}
var subproblemRowColumns = []string{"id", "problem_id", "label"}

// newAccess builds a tiny AccessTokenService for tests; matching pattern in
// the auth handler tests.
func newAccess(t *testing.T) *internalAuth.AccessTokenService {
	t.Helper()
	a, err := internalAuth.NewAccessTokenService(internalAuth.AccessTokenConfig{
		Secret:     "test-secret",
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("access service: %v", err)
	}
	return a
}

// authedRequest builds a request with a valid access token for the given
// user id, so AuthMiddleware accepts it and ctxcache.UserID returns userID.
func authedRequest(t *testing.T, access *internalAuth.AccessTokenService, userID int64, method, path string, body io.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	tok, err := access.Generate(userID, fmt.Sprintf("user%d", userID), false)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	return req
}

// newRouter wires the math center router around a mock pool and a fresh
// MemoryStore. The TokenService is constructed with the same access service
// the test uses to mint tokens, so the middleware and the helper agree.
func newRouter(t *testing.T, mock pgxmock.PgxPoolIface) (http.Handler, *internalAuth.AccessTokenService, *objectstore.MemoryStore) {
	t.Helper()
	database := db.NewDBWithPool(mock)
	access := newAccess(t)
	refresh, err := internalAuth.NewRefreshTokenService(internalAuth.RefreshTokenConfig{
		DB:         database,
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("refresh service: %v", err)
	}
	tokens, err := internalAuth.NewTokenService(internalAuth.TokenServiceConfig{
		Access: access, Refresh: refresh,
	})
	if err != nil {
		t.Fatalf("token service: %v", err)
	}
	blobs := objectstore.NewMemory()
	return mcHandlers.Router(database, tokens, blobs, time.Minute), access, blobs
}

func TestRouter_RequiresAuth(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, _, _ := newRouter(t, mock)

	cases := []struct {
		method, path string
	}{
		{http.MethodGet, "/centers/1/series"},
		{http.MethodPost, "/centers/1/series"},
		{http.MethodGet, "/series/1"},
		{http.MethodPut, "/series/1"},
		{http.MethodDelete, "/series/1"},
		{http.MethodPost, "/series/1/pdf"},
		{http.MethodGet, "/series/1/pdf"},
	}
	for _, c := range cases {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Errorf("got %d, want 401", rr.Code)
			}
		})
	}
}

func TestCreateSeries_RejectsNonTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))

	body, _ := json.Marshal(map[string]any{
		"number": 1, "name": "S", "due_at": time.Now().Add(time.Hour),
		"problems": []map[string]int{{"number": 1, "subproblem_count": 0}},
	})
	req := authedRequest(t, access, 7, http.MethodPost, "/centers/42/series", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestCreateSeries_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(48 * time.Hour)

	// 1. teacher check
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	// 2. CreateSeries
	mock.ExpectQuery(`INSERT INTO math_center_series`).
		WithArgs(int64(42), int32(3), "Алгебра", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(3), "Алгебра", due, (*string)(nil), (*time.Time)(nil), now))
	// 3. CreateProblem (number=0 "Упражнение", with 2 subproblems a/b)
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(0)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(500), int64(100), int32(0), now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(500), "a").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(900), int64(500), "a", now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(500), "b").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(901), int64(500), "b", now))
	// 4. CreateProblem (number=1, no subproblems)
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(1)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(501), int64(100), int32(1), now))
	// 5. buildSeriesView: list problems + list subproblems
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns).
			AddRow(int64(500), int64(100), int32(0), now).
			AddRow(int64(501), int64(100), int32(1), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns).
			AddRow(int64(900), int64(500), "a").
			AddRow(int64(901), int64(500), "b"))

	body, _ := json.Marshal(map[string]any{
		"number": 3, "name": "Алгебра", "due_at": due,
		"problems": []map[string]int{
			{"number": 0, "subproblem_count": 2},
			{"number": 1, "subproblem_count": 0},
		},
	})
	req := authedRequest(t, access, 7, http.MethodPost, "/centers/42/series", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["display_name"] != "Серия 3. Алгебра" {
		t.Errorf("display_name: got %v", got["display_name"])
	}
	if got["published"].(bool) {
		t.Error("freshly created series should not be published")
	}
	problems, _ := got["problems"].([]any)
	if len(problems) != 2 {
		t.Fatalf("problems: got %d, want 2", len(problems))
	}
	first := problems[0].(map[string]any)
	if first["display_name"] != "Упражнение" {
		t.Errorf("problem 0 display_name: got %v", first["display_name"])
	}
	subs := first["subproblems"].([]any)
	if len(subs) != 2 || subs[0] != "a" || subs[1] != "b" {
		t.Errorf("subproblems: got %v", subs)
	}
}

func TestCreateSeries_ValidationErrors(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty name", map[string]any{"number": 1, "name": "", "due_at": time.Now(), "problems": []map[string]int{{"number": 1}}}},
		{"no problems", map[string]any{"number": 1, "name": "x", "due_at": time.Now(), "problems": []map[string]int{}}},
		{"duplicate problem number", map[string]any{"number": 1, "name": "x", "due_at": time.Now(),
			"problems": []map[string]int{{"number": 1}, {"number": 1}}}},
		{"too many subproblems", map[string]any{"number": 1, "name": "x", "due_at": time.Now(),
			"problems": []map[string]int{{"number": 1, "subproblem_count": 999}}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b, _ := json.Marshal(c.body)
			req := authedRequest(t, access, 7, http.MethodPost, "/centers/42/series", bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestListSeries_StudentSeesOnlyPublished(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	// Membership: not teacher, is student.
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(true))
	// Published-only list.
	pubAt := now
	key := "mathcenter/series/100.pdf"
	mock.ExpectQuery(`FROM math_center_series\s+WHERE math_center_id = \$1\s+AND published_at IS NOT NULL`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "Опубликованная", now.Add(time.Hour), &key, &pubAt, now))
	// buildSeriesView for the one row.
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(500), int64(100), int32(1), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))

	req := authedRequest(t, access, 7, http.MethodGet, "/centers/42/series", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var list []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("want 1 series, got %d", len(list))
	}
	if !list[0]["published"].(bool) {
		t.Error("student listing should only include published series")
	}
}

func TestListSeries_NonMemberForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))

	req := authedRequest(t, access, 7, http.MethodGet, "/centers/42/series", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}

func TestGetSeries_StudentDraftHidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "Черновик", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(true))

	req := authedRequest(t, access, 7, http.MethodGet, "/series/100", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("draft visible to student: got %d, want 404", rr.Code)
	}
}

func TestGetSeries_NotFound(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(999)).
		WillReturnError(pgx.ErrNoRows)

	req := authedRequest(t, access, 7, http.MethodGet, "/series/999", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404", rr.Code)
	}
}

func TestPublishAndDownload(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)

	// --- publish step ---
	// GetSeries
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now))
	// teacher check
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	// PublishSeries
	key := "mathcenter/series/100.pdf"
	pubAt := now
	mock.ExpectQuery(`UPDATE math_center_series\s+SET pdf_object_key`).
		WithArgs(int64(100), &key).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, &key, &pubAt, now))
	// buildSeriesView
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))

	body, contentType := buildPDFMultipart(t, "%PDF-1.4 fake")
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf", body)
	req.Header.Set("Content-Type", contentType)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("publish: got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if ok, _ := blobs.Exists(req.Context(), key); !ok {
		t.Fatal("publish should have stored the object")
	}

	// --- download step ---
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, &key, &pubAt, now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))

	dlReq := authedRequest(t, access, 7, http.MethodGet, "/series/100/pdf", nil)
	dlRR := httptest.NewRecorder()
	r.ServeHTTP(dlRR, dlReq)
	if dlRR.Code != http.StatusFound {
		t.Fatalf("download: got %d, want 302; body=%s", dlRR.Code, dlRR.Body.String())
	}
	loc := dlRR.Header().Get("Location")
	if !strings.HasPrefix(loc, "memory://") || !strings.HasSuffix(loc, key) {
		t.Errorf("redirect location: got %q", loc)
	}
}

func TestPublish_RejectsNonPDF(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	body, contentType := buildMultipart(t, "file", "f.txt", "text/plain", []byte("not a pdf"))
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf", body)
	req.Header.Set("Content-Type", contentType)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnsupportedMediaType {
		t.Errorf("got %d, want 415", rr.Code)
	}
}

func TestPublish_TooLarge(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	huge := bytes.Repeat([]byte("A"), int(mcHandlers.MaxPDFBytes)+512)
	body, contentType := buildMultipart(t, "file", "x.pdf", "application/pdf", huge)
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf", body)
	req.Header.Set("Content-Type", contentType)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	// Either MaxBytesReader cuts the multipart parser early (400) or the
	// in-handler size check fires (413). Both are correct rejections.
	if rr.Code != http.StatusRequestEntityTooLarge && rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 413 or 400", rr.Code)
	}
}

func TestDelete_TeacherRemovesObject(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	pubAt := now
	key := "mathcenter/series/100.pdf"
	// Pre-seed the blob so we can confirm Delete removes it.
	_ = blobs.Put(t.Context(), key, strings.NewReader("PDF"), 3, "application/pdf")

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), &key, &pubAt, now))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectExec(`DELETE\s+FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	req := authedRequest(t, access, 7, http.MethodDelete, "/series/100", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204; body=%s", rr.Code, rr.Body.String())
	}
	if ok, _ := blobs.Exists(req.Context(), key); ok {
		t.Error("delete should have removed the object")
	}
}

// Multipart helpers ----------------------------------------------------------

func buildPDFMultipart(t *testing.T, content string) (*bytes.Buffer, string) {
	return buildMultipart(t, "file", "series.pdf", "application/pdf", []byte(content))
}

func buildMultipart(t *testing.T, field, filename, contentType string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, field, filename))
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}
