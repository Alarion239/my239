package homework_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	hwHandlers "github.com/Alarion239/my239/backend/internal/handlers/homework"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Column lists must match the SELECT order in the underlying sqlc query.
// Keep these in sync with queries/homework.sql when changing it.
var threadColumns = []string{
	"id", "student_user_id", "subproblem_id", "series_id", "math_center_id",
	"current_status", "current_attempt_event_id", "current_grade_event_id",
	"last_grader_user_id", "claim_holder_user_id", "claim_expires_at",
	"created_at", "updated_at",
}

var eventColumns = []string{
	"id", "thread_id", "event_uuid", "kind", "actor_user_id", "body", "verdict",
	"refers_to_event_id", "created_at",
}

var subproblemCtxColumns = []string{
	"subproblem_id", "subproblem_label", "problem_id", "problem_number",
	"series_id", "math_center_id", "series_due_at", "series_published_at",
}

var seriesColumns = []string{
	"id", "math_center_id", "number", "name", "due_at",
	"pdf_object_key", "published_at", "created_at", "tex_source",
}

var queueRowColumns = []string{
	"id", "student_user_id", "subproblem_id", "series_id", "math_center_id",
	"current_status", "last_grader_user_id", "claim_holder_user_id",
	"claim_expires_at", "updated_at",
	"student_first_name", "student_middle_name", "student_last_name",
	"subproblem_label", "problem_number",
}

// newAccess builds a tiny AccessTokenService for tests, matching the
// mathcenter test helper.
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

// authedRequest mints a token for userID and stamps it on a fresh request,
// so AuthMiddleware accepts and ctxcache.UserID resolves correctly.
func authedRequest(t *testing.T, access *internalAuth.AccessTokenService, userID int64, isAdmin bool, method, path string, body io.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	tok, err := access.Generate(userID, fmt.Sprintf("user%d", userID), isAdmin)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	return req
}

// newRouter wires the homework router around a pgxmock pool and a fresh
// MemoryStore. The TokenService uses the same access service the test
// helper mints from, so middleware and helper agree on the secret.
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
	return hwHandlers.Router(database, tokens, blobs, time.Minute, time.Minute), access, blobs
}

// expectTeacherCheck adds the standard "is this user a teacher of this
// center?" expectation. ok is the boolean result.
func expectTeacherCheck(mock pgxmock.PgxPoolIface, userID, centerID int64, ok bool) {
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(ok))
}

// expectStudentCheck adds the standard "is this user a student of this
// center?" expectation.
func expectStudentCheck(mock pgxmock.PgxPoolIface, userID, centerID int64, ok bool) {
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(userID, centerID).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(ok))
}

// expectSubproblemContext adds the GetSubproblemContext expectation. due is
// the series.due_at; publishedAt is non-nil for published series.
func expectSubproblemContext(mock pgxmock.PgxPoolIface, subproblemID, problemID, seriesID, centerID int64, problemNumber int32, label string, due time.Time, publishedAt *time.Time) {
	mock.ExpectQuery(`FROM math_center_subproblems sp\s+JOIN math_center_problems`).
		WithArgs(subproblemID).
		WillReturnRows(mock.NewRows(subproblemCtxColumns).
			AddRow(subproblemID, label, problemID, problemNumber, seriesID, centerID, due, publishedAt))
}

// expectGetSeriesForView adds the GetSeries expectation that buildThreadView
// makes before fetching the timeline. The frontend uses series.due_at to
// decide whether to show the submit form, so the thread response always
// joins it in — and every test that exercises a buildThreadView path needs
// this mock to be queued before the ListThreadEvents one.
func expectGetSeriesForView(mock pgxmock.PgxPoolIface, seriesID, centerID int64, now time.Time) {
	pub := now
	mock.ExpectQuery(`SELECT .* FROM math_center_series WHERE id`).
		WithArgs(seriesID).
		WillReturnRows(mock.NewRows(seriesColumns).
			AddRow(seriesID, centerID, int32(1), "S", now.Add(time.Hour), (*string)(nil), &pub, now, (*string)(nil)))
}

// expectGetUsersForView adds the bulk-user lookup buildThreadView makes
// right after the events list, so it can replace user_ids with display
// names in the response. Tests don't usually care about the names, so
// the default return is empty rows — the handler tolerates missing names
// gracefully.
func expectGetUsersForView(mock pgxmock.PgxPoolIface) {
	// The actual []int64 the handler passes varies per test (student id,
	// graders, every event actor). We don't care to assert it here —
	// AnyArg keeps the mock loose so any user-id set goes through.
	mock.ExpectQuery(`SELECT id, first_name, middle_name, last_name\s+FROM users\s+WHERE id = ANY`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows([]string{"id", "first_name", "middle_name", "last_name"}))
}

// emptyThreadRow returns a brand-new thread row matching FindOrCreateThread's
// RETURNING list, suitable for AddRow.
func emptyThreadRow(threadID, studentID, subID, seriesID, centerID int64, now time.Time) []any {
	return []any{
		threadID, studentID, subID, seriesID, centerID,
		"ungraded",        // current_status
		(*int64)(nil),     // current_attempt_event_id
		(*int64)(nil),     // current_grade_event_id
		(*int64)(nil),     // last_grader_user_id
		(*int64)(nil),     // claim_holder_user_id
		(*time.Time)(nil), // claim_expires_at
		now, now,
	}
}

// threadRow returns a homework_thread row with custom status/grade/claim
// fields for tests that need a non-pristine starting state.
type threadRowOpts struct {
	Status         string
	AttemptEventID *int64
	GradeEventID   *int64
	LastGraderID   *int64
	ClaimHolderID  *int64
	ClaimExpiresAt *time.Time
}

func threadRow(threadID, studentID, subID, seriesID, centerID int64, opts threadRowOpts, now time.Time) []any {
	status := opts.Status
	if status == "" {
		status = "ungraded"
	}
	return []any{
		threadID, studentID, subID, seriesID, centerID,
		status,
		opts.AttemptEventID,
		opts.GradeEventID,
		opts.LastGraderID,
		opts.ClaimHolderID,
		opts.ClaimExpiresAt,
		now, now,
	}
}
