package mathcenter_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
	"pdf_object_key", "published_at", "created_at", "tex_source",
}

// subproblemSolutionMetaColumns matches ListSubproblemSolutionsForSeries, which
// buildSeriesView issues to merge per-subproblem разбор/coffin metadata.
var subproblemSolutionMetaColumns = []string{
	"subproblem_id", "problem_id", "is_coffin", "released_at",
	"has_solution_tex", "has_solution_pdf", "solution_link",
}

var (
	problemColumns       = []string{"id", "series_id", "number", "created_at"}
	subproblemRowColumns = []string{"id", "problem_id", "label"}
)

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
	return tokenRequest(t, access, userID, false, method, path, body)
}

// authedAdminRequest is like authedRequest but mints a token whose is_admin
// claim is true, so callerIsAdmin (config.CtxKeyIsAdmin) reports true and the
// admin teacher-superset bypass applies.
func authedAdminRequest(t *testing.T, access *internalAuth.AccessTokenService, userID int64, method, path string, body io.Reader) *http.Request {
	t.Helper()
	return tokenRequest(t, access, userID, true, method, path, body)
}

func tokenRequest(t *testing.T, access *internalAuth.AccessTokenService, userID int64, isAdmin bool, method, path string, body io.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	tok, err := access.Generate(userID, fmt.Sprintf("user%d", userID), isAdmin)
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
	database := db.NewWithPool(mock)
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
	return mcHandlers.Router(database, tokens, blobs, time.Minute, time.Minute), access, blobs
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
		{http.MethodPost, "/series/1/pdf/upload-url"},
		{http.MethodPost, "/series/1/pdf/publish"},
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
	// 2. CreateSeries + its problems run in one transaction.
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO math_center_series`).
		WithArgs(int64(42), int32(3), "Алгебра", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(3), "Алгебра", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
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
	// 4. CreateProblem (number=1, declared with 0 real subparts) plus the
	//    sentinel subproblem (label='') the handler now creates so future
	//    homework_thread rows have a stable subproblem FK to anchor to.
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(1)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(501), int64(100), int32(1), now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(501), "").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(910), int64(501), "", now))
	mock.ExpectCommit()
	// 5. buildSeriesView: list problems + list subproblems. The sentinel
	//    row is returned by the DB but buildSeriesView strips empty labels.
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns).
			AddRow(int64(500), int64(100), int32(0), now).
			AddRow(int64(501), int64(100), int32(1), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns).
			AddRow(int64(900), int64(500), "a").
			AddRow(int64(901), int64(500), "b").
			AddRow(int64(910), int64(501), ""))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

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
	if len(subs) != 2 || subs[0].(map[string]any)["label"] != "a" || subs[1].(map[string]any)["label"] != "b" {
		t.Errorf("subproblems: got %v", subs)
	}
	if subs[0].(map[string]any)["display"] != "Упражнение (a)" {
		t.Errorf("subproblem display: got %v", subs[0].(map[string]any)["display"])
	}
}

// TestCreateSeries_AdminBypassesEnrollment proves the admin teacher-superset:
// an admin (is_admin via JWT) who is NOT enrolled as a teacher of the center
// can still create a series. The proof is in the expectations — NO
// math_center_teachers lookup is set up, so requireTeacher MUST short-circuit
// on callerIsAdmin or the test fails on an unexpected query.
func TestCreateSeries_AdminBypassesEnrollment(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(48 * time.Hour)

	// No teacher check is expected: the admin bypass skips it entirely.
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO math_center_series`).
		WithArgs(int64(42), int32(1), "Админ-серия", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "Админ-серия", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	// One problem declared with 0 real subparts -> sentinel subproblem (label='').
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(1)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(500), int64(100), int32(1), now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(500), "").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(900), int64(500), "", now))
	mock.ExpectCommit()
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(500), int64(100), int32(1), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns).AddRow(int64(900), int64(500), ""))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	body, _ := json.Marshal(map[string]any{
		"number": 1, "name": "Админ-серия", "due_at": due,
		"problems": []map[string]int{{"number": 1, "subproblem_count": 0}},
	})
	// user 9 is an admin but is NOT enrolled as a teacher of center 42.
	req := authedAdminRequest(t, access, 9, http.MethodPost, "/centers/42/series", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("got %d, want 201; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestGetSeries_AdminSeesDraft proves the read side of the superset: an
// unenrolled admin gets teacher-level visibility, so a draft series (no
// published_at) returns 200 rather than the 404 a student would get. No
// membership lookups are expected — membership() short-circuits on admin.
func TestGetSeries_AdminSeesDraft(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "Черновик", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	// buildSeriesView reads problems + subproblems for the single series.
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	req := authedAdminRequest(t, access, 9, http.MethodGet, "/series/100", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("admin should see draft: got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestUpdateSeries_TeacherRebuildsProblems exercises the transactional
// rebuild path: update the series row, delete its problems (cascade), rewrite
// them, commit — then re-read for the response view. The Begin/Commit
// expectations assert the whole rebuild happens in one transaction so a
// partial failure can't destroy a series' problems.
func TestUpdateSeries_TeacherRebuildsProblems(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	oldDue := now.Add(24 * time.Hour)
	newDue := now.Add(72 * time.Hour)

	// 1. Load the existing series (for its center id + teacher check).
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(3), "Алгебра", oldDue, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	// 2. Teacher check.
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	// 3. The rebuild runs in a single transaction.
	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE math_center_series`).
		WithArgs(int64(100), int32(5), "Геометрия", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(5), "Геометрия", newDue, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectExec(`DELETE\s+FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(0)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(600), int64(100), int32(0), now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(600), "a").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(700), int64(600), "a", now))
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(600), "b").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).AddRow(int64(701), int64(600), "b", now))
	mock.ExpectCommit()
	// 4. buildSeriesView re-reads the rewritten problems on the pool.
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(600), int64(100), int32(0), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns).
			AddRow(int64(700), int64(600), "a").
			AddRow(int64(701), int64(600), "b"))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	body, _ := json.Marshal(map[string]any{
		"number": 5, "name": "Геометрия", "due_at": newDue,
		"problems": []map[string]int{{"number": 0, "subproblem_count": 2}},
	})
	req := authedRequest(t, access, 7, http.MethodPut, "/series/100", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["display_name"] != "Серия 5. Геометрия" {
		t.Errorf("display_name: got %v", got["display_name"])
	}
	problems, _ := got["problems"].([]any)
	if len(problems) != 1 {
		t.Fatalf("problems: got %d, want 1", len(problems))
	}
	subs := problems[0].(map[string]any)["subproblems"].([]any)
	if len(subs) != 2 || subs[0].(map[string]any)["label"] != "a" || subs[1].(map[string]any)["label"] != "b" {
		t.Errorf("subproblems: got %v", subs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestUpdateSeries_RollsBackOnProblemFailure verifies the transaction is
// rolled back (not committed) when a problem insert fails mid-rebuild, so a
// failed update can't leave the series with its problems deleted.
func TestUpdateSeries_RollsBackOnProblemFailure(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(3), "Алгебра", now, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE math_center_series`).
		WithArgs(int64(100), int32(5), "Геометрия", pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(5), "Геометрия", now, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectExec(`DELETE\s+FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	// The first problem insert fails -> handler returns 500 and the deferred
	// rollback fires; Commit must never be called.
	mock.ExpectQuery(`INSERT INTO math_center_problems`).
		WithArgs(int64(100), int32(0)).
		WillReturnError(fmt.Errorf("boom"))
	mock.ExpectRollback()

	body, _ := json.Marshal(map[string]any{
		"number": 5, "name": "Геометрия", "due_at": now.Add(72 * time.Hour),
		"problems": []map[string]int{{"number": 0, "subproblem_count": 2}},
	})
	req := authedRequest(t, access, 7, http.MethodPut, "/series/100", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
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
		{"duplicate problem number", map[string]any{
			"number": 1, "name": "x", "due_at": time.Now(),
			"problems": []map[string]int{{"number": 1}, {"number": 1}},
		}},
		{"too many subproblems", map[string]any{
			"number": 1, "name": "x", "due_at": time.Now(),
			"problems": []map[string]int{{"number": 1, "subproblem_count": 999}},
		}},
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
			AddRow(int64(100), int64(42), int32(1), "Опубликованная", now.Add(time.Hour), &key, &pubAt, now, (*string)(nil)))
	// buildSeriesViews batches problems/subproblems across the series set
	// with = ANY($1), so the arg is a slice of ids.
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id = ANY`).
		WithArgs([]int64{100}).
		WillReturnRows(mock.NewRows(problemColumns).AddRow(int64(500), int64(100), int32(1), now))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs([]int64{100}).
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
			AddRow(int64(100), int64(42), int32(1), "Черновик", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
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

// TestPDFUploadURLAndPublish exercises the new two-step flow end-to-end:
// (1) /pdf/upload-url mints a presigned URL and reports the canonical key,
// (2) we simulate the client uploading by writing into the MemoryStore,
// (3) /pdf/publish Stat-validates the object and marks the series published,
// (4) /pdf redirects to a presigned GET URL pointing at the same key.
func TestPDFUploadURLAndPublish(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	key := "mathcenter/series/100.pdf"

	// --- step 1: /pdf/upload-url ---
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/upload-url", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("upload-url: got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var ur struct {
		ObjectKey string `json:"object_key"`
		UploadURL string `json:"upload_url"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &ur)
	if ur.ObjectKey != key {
		t.Errorf("ObjectKey: got %q, want %q", ur.ObjectKey, key)
	}
	if !strings.HasPrefix(ur.UploadURL, "memory://put/") {
		t.Errorf("UploadURL: got %q, want memory://put/ prefix", ur.UploadURL)
	}

	// --- simulate client PUT to Yandex by writing directly into the memory store ---
	if err := blobs.Put(context.Background(), key, strings.NewReader("%PDF-1.4 fake"), 13, "application/pdf"); err != nil {
		t.Fatalf("seed blob: %v", err)
	}

	// --- step 2: /pdf/publish ---
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	pubAt := now
	mock.ExpectQuery(`UPDATE math_center_series\s+SET pdf_object_key`).
		WithArgs(int64(100), &key).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, &key, &pubAt, now, (*string)(nil)))
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	pubBody, _ := json.Marshal(map[string]string{"object_key": key})
	pubReq := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/publish", bytes.NewReader(pubBody))
	pubReq.Header.Set("Content-Type", "application/json")
	pubRR := httptest.NewRecorder()
	r.ServeHTTP(pubRR, pubReq)
	if pubRR.Code != http.StatusOK {
		t.Fatalf("publish: got %d, want 200; body=%s", pubRR.Code, pubRR.Body.String())
	}

	// --- step 3: download still redirects ---
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, &key, &pubAt, now, (*string)(nil)))
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

// TestPDFPublish_RejectsMissingObject verifies the finalize step refuses to
// flip a series to published if nothing was actually uploaded.
func TestPDFPublish_RejectsMissingObject(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	body, _ := json.Marshal(map[string]string{"object_key": "mathcenter/series/100.pdf"})
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/publish", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404 (no upload yet); body=%s", rr.Code, rr.Body.String())
	}
}

// TestPDFPublish_RejectsWrongContentType verifies the finalize step Stat-
// validates the content type and refuses non-PDF objects, even if the file
// landed at the right key.
func TestPDFPublish_RejectsWrongContentType(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	key := "mathcenter/series/100.pdf"
	// Seed an object at the canonical key but with the wrong type.
	_ = blobs.Put(context.Background(), key, strings.NewReader("not a pdf"), 9, "text/plain")

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	body, _ := json.Marshal(map[string]string{"object_key": key})
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/publish", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

// TestPDFPublish_RejectsOversize verifies finalize refuses a PDF that
// exceeds MaxPDFBytes, even after a 'successful' upload to Yandex.
func TestPDFPublish_RejectsOversize(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, blobs := newRouter(t, mock)

	now := time.Now()
	key := "mathcenter/series/100.pdf"
	huge := bytes.Repeat([]byte("A"), int(mcHandlers.MaxPDFBytes)+512)
	_ = blobs.Put(context.Background(), key, bytes.NewReader(huge), int64(len(huge)), "application/pdf")

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	body, _ := json.Marshal(map[string]string{"object_key": key})
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/publish", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("got %d, want 413; body=%s", rr.Code, rr.Body.String())
	}
}

// TestPDFPublish_RejectsForeignKey verifies finalize refuses an object_key
// that doesn't match the canonical layout for this series — defense against
// a malicious client trying to publish a key the server didn't sign.
func TestPDFPublish_RejectsForeignKey(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))

	body, _ := json.Marshal(map[string]string{"object_key": "mathcenter/series/999.pdf"})
	req := authedRequest(t, access, 7, http.MethodPost, "/series/100/pdf/publish", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
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
			AddRow(int64(100), int64(42), int32(1), "S", now.Add(time.Hour), &key, &pubAt, now, (*string)(nil)))
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

func TestPutSeriesTex_TeacherSucceeds(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	tex := "\\documentclass{article}\n\\usepackage[russian]{babel}\n\\begin{document}\nПривет!\n\\end{document}\n"
	pubAt := now

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectQuery(`UPDATE math_center_series\s+SET tex_source`).
		WithArgs(int64(100), &tex).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), &pubAt, now, &tex))
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	body, _ := json.Marshal(map[string]string{"tex": tex})
	req := authedRequest(t, access, 7, http.MethodPut, "/series/100/tex", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var view struct {
		HasTex    bool `json:"has_tex"`
		Published bool `json:"published"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &view)
	if !view.HasTex {
		t.Error("response should have has_tex=true")
	}
	if !view.Published {
		t.Error("setting tex on a draft should publish it")
	}
}

func TestPutSeriesTex_RejectsMalformed(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		tex  string
	}{
		{"empty", ""},
		{"missing begin document", "\\documentclass{article}\nhi\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mock, _ := pgxmock.NewPool()
			defer mock.Close()
			r, access, _ := newRouter(t, mock)

			body, _ := json.Marshal(map[string]string{"tex": tc.tex})
			req := authedRequest(t, access, 7, http.MethodPut, "/series/100/tex", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestPutSeriesTex_RejectsNonTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now, (*string)(nil)))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))

	tex := "\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n"
	body, _ := json.Marshal(map[string]string{"tex": tex})
	req := authedRequest(t, access, 7, http.MethodPut, "/series/100/tex", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetSeriesTex_StudentReadsPublished(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	tex := "\\documentclass{article}\\begin{document}Серия 1\\end{document}"
	pubAt := now

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), &pubAt, now, &tex))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(true))

	req := authedRequest(t, access, 7, http.MethodGet, "/series/100/tex", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Tex string `json:"tex"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Tex != tex {
		t.Errorf("Tex: got %q, want %q", resp.Tex, tex)
	}
}

func TestGetSeriesTex_StudentBlockedOnDraft(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	tex := "\\documentclass{article}\\begin{document}draft\\end{document}"

	// Draft series with tex but no published_at: students see 404.
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), (*time.Time)(nil), now, &tex))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(true))

	req := authedRequest(t, access, 7, http.MethodGet, "/series/100/tex", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestDeleteSeriesTex_TeacherClears(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	due := now.Add(time.Hour)
	tex := "\\documentclass{article}\\begin{document}x\\end{document}"
	pubAt := now

	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), &pubAt, now, &tex))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(true))
	mock.ExpectQuery(`UPDATE math_center_series\s+SET tex_source = NULL`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(int64(100), int64(42), int32(1), "S", due, (*string)(nil), &pubAt, now, (*string)(nil)))
	mock.ExpectQuery(`SELECT .* FROM math_center_problems WHERE series_id`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(problemColumns))
	mock.ExpectQuery(`FROM math_center_subproblems s\s+JOIN math_center_problems`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemRowColumns))
	mock.ExpectQuery(`FROM math_center_subproblem_solutions ss`).
		WithArgs(int64(100)).
		WillReturnRows(mock.NewRows(subproblemSolutionMetaColumns))

	req := authedRequest(t, access, 7, http.MethodDelete, "/series/100/tex", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}
