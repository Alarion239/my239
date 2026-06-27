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

// userColumns mirrors users.* (GetUserByID SELECT *).
var userColumns = []string{
	"id", "username", "password_hash", "first_name", "middle_name", "last_name",
	"invitation_token_id", "created_at", "updated_at", "is_admin", "is_math_center",
}

func userRow(id int64, first, last string, now time.Time) []any {
	return []any{
		id, "user", "hash", first, (*string)(nil), last,
		(*int64)(nil), now, now, false, false,
	}
}

// expectGetUserByID queues the GetUserByID lookup used to credit a grader.
func expectGetUserByID(mock pgxmock.PgxPoolIface, id int64, first, last string, now time.Time) {
	mock.ExpectQuery(`SELECT .* FROM users\s+WHERE id`).
		WithArgs(id).
		WillReturnRows(mock.NewRows(userColumns).AddRow(userRow(id, first, last, now)...))
}

// expectOfflineAcceptTx queues the find-or-create + accept transaction +
// post-mutation view fetch shared by the accept happy paths. creditedID may
// be nil (free-text grader); creditedName is the stored display name.
func expectOfflineAcceptTx(mock pgxmock.PgxPoolIface, threadID, studentID, subID, seriesID, centerID, actorID int64, creditedID *int64, creditedName string, now time.Time) {
	mock.ExpectQuery(`INSERT INTO homework_thread \(`).
		WithArgs(studentID, subID, seriesID, centerID).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(threadID, studentID, subID, seriesID, centerID, threadRowOpts{Status: "ungraded"}, now)...))

	verdict := "accepted"
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(threadID, pgxmock.AnyArg(), "accepted_offline", actorID, "", &verdict, (*int64)(nil), creditedID, creditedName).
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			int64(80), threadID, "uuid", "accepted_offline", actorID, "", &verdict, (*int64)(nil), now, true, creditedID, creditedName))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'accepted'`).
		WithArgs(int64(80), creditedID, creditedName, threadID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	// Post-mutation view fetch.
	gradeID := int64(80)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(threadID).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(threadID, studentID, subID, seriesID, centerID, threadRowOpts{
				Status: "accepted", GradeEventID: &gradeID, LastGraderID: creditedID, LastGraderName: creditedName,
			}, now)...))
	expectGetSeriesForView(mock, seriesID, centerID, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(threadID).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)
}

func TestOfflineAccept_PhoneFlowCreditsTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	// No grader fields → credit the session user (id 3).
	expectGetUserByID(mock, 3, "Мария", "Кузнецова", now)
	creditedID := int64(3)
	expectOfflineAcceptTx(mock, 1, 7, 900, 100, 42, 3, &creditedID, "Мария Кузнецова", now)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_ConduitResolvedTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	// grader_user_id=9 must be validated as a teacher of the center, then named.
	expectTeacherCheck(mock, 9, 42, true)
	expectGetUserByID(mock, 9, "Пётр", "Сидоров", now)
	creditedID := int64(9)
	expectOfflineAcceptTx(mock, 1, 7, 900, 100, 42, 3, &creditedID, "Пётр Сидоров", now)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900, "grader_user_id": 9})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_ConduitFreeTextGrader(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	// Free-text grader → unregistered, last_grader_user_id stays NULL.
	expectOfflineAcceptTx(mock, 1, 7, 900, 100, 42, 3, nil, "Иванов", now)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900, "grader_name": "  Иванов  "})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_GraderNotTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	expectTeacherCheck(mock, 9, 42, false) // credited grader is NOT a teacher

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900, "grader_user_id": 9})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_AlreadyAccepted(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	expectGetUserByID(mock, 3, "Мария", "Кузнецова", now)
	// Find-or-create returns a thread accepted via an ONLINE grade → 409.
	gradeID := int64(80)
	mock.ExpectQuery(`INSERT INTO homework_thread \(`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: "accepted", GradeEventID: &gradeID}, now)...))
	verdict := "accepted"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE id`).
		WithArgs(gradeID).
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			gradeID, int64(1), "uuid", "graded", int64(3), "ok", &verdict, (*int64)(nil), now, false, (*int64)(nil), ""))

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_RecreditsOfflineAccept(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, true)
	gradeID := int64(80)
	// Find-or-create returns a thread already accepted OFFLINE (credited "АБ").
	mock.ExpectQuery(`INSERT INTO homework_thread \(`).
		WithArgs(int64(7), int64(900), int64(100), int64(42)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{
				Status: "accepted", GradeEventID: &gradeID, LastGraderName: "АБ",
			}, now)...))
	verdict := "accepted"
	// GetEvent(grade) → is_offline = true, so re-crediting is allowed.
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE id`).
		WithArgs(gradeID).
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			gradeID, int64(1), "uuid", "accepted_offline", int64(3), "", &verdict, (*int64)(nil), now, true, (*int64)(nil), "АБ"))

	// Re-credit tx: new accepted_offline event + cache repoint to "МК".
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), pgxmock.AnyArg(), "accepted_offline", int64(3), "", &verdict, (*int64)(nil), (*int64)(nil), "МК").
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			int64(81), int64(1), "uuid2", "accepted_offline", int64(3), "", &verdict, (*int64)(nil), now, true, (*int64)(nil), "МК"))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= 'accepted'`).
		WithArgs(int64(81), (*int64)(nil), "МК", int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	// Post-mutation view.
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{
				Status: "accepted", GradeEventID: &gradeID, LastGraderName: "МК",
			}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900, "grader_name": "МК"})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineAccept_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	expectSubproblemContext(mock, 900, 500, 100, 42, 1, "", now.Add(time.Hour), &now)
	expectTeacherCheck(mock, 3, 42, false)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineUndo_RevertsToUngraded(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	gradeID := int64(80)
	// GetThreadByStudentAndSubproblem → an offline-accepted thread, no attempt.
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE student_user_id`).
		WithArgs(int64(7), int64(900)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{
				Status: "accepted", GradeEventID: &gradeID, LastGraderName: "Иванов",
			}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	// GetEvent(grade) → is_offline = true.
	verdict := "accepted"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE id`).
		WithArgs(gradeID).
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			gradeID, int64(1), "uuid", "accepted_offline", int64(3), "", &verdict, (*int64)(nil), now, true, (*int64)(nil), "Иванов"))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO homework_thread_event`).
		WithArgs(int64(1), pgxmock.AnyArg(), "offline_retracted", int64(3), "", (*string)(nil), &gradeID, (*int64)(nil), "").
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			int64(81), int64(1), "uuid2", "offline_retracted", int64(3), "", (*string)(nil), &gradeID, now, true, (*int64)(nil), ""))
	mock.ExpectExec(`UPDATE homework_thread\s+SET current_status\s+= \$1`).
		WithArgs("ungraded", int64(1)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	// Post-mutation view.
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: "ungraded"}, now)...))
	expectGetSeriesForView(mock, 100, 42, now)
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE thread_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows(eventColumns))
	expectGetUsersForView(mock)

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/undo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestOfflineUndo_RejectsOnlineGrade(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	now := time.Now()
	gradeID := int64(80)
	mock.ExpectQuery(`SELECT .* FROM homework_thread\s+WHERE student_user_id`).
		WithArgs(int64(7), int64(900)).
		WillReturnRows(mock.NewRows(threadColumns).AddRow(
			threadRow(1, 7, 900, 100, 42, threadRowOpts{Status: "accepted", GradeEventID: &gradeID}, now)...))
	expectTeacherCheck(mock, 3, 42, true)
	// The current grade is an ONLINE graded event (is_offline=false) → 409.
	verdict := "accepted"
	mock.ExpectQuery(`SELECT .* FROM homework_thread_event\s+WHERE id`).
		WithArgs(gradeID).
		WillReturnRows(mock.NewRows(eventColumns).AddRow(
			gradeID, int64(1), "uuid", "graded", int64(3), "ok", &verdict, (*int64)(nil), now, false, (*int64)(nil), ""))

	body, _ := json.Marshal(map[string]any{"student_user_id": 7, "subproblem_id": 900})
	req := authedRequest(t, access, 3, false, http.MethodPost, "/offline/undo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
}

func TestCenterTeachers_HappyPath(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, true)
	teacherCols := []string{"id", "user_id", "math_center_id", "is_head_teacher", "first_name", "middle_name", "last_name"}
	mock.ExpectQuery(`FROM math_center_teachers t\s+JOIN users u`).
		WithArgs(int64(42)).
		WillReturnRows(mock.NewRows(teacherCols).
			AddRow(int64(1), int64(9), int64(42), true, "Пётр", (*string)(nil), "Сидоров").
			AddRow(int64(2), int64(3), int64(42), false, "Мария", (*string)(nil), "Кузнецова"))

	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/teachers", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Teachers []struct {
			UserID   int64  `json:"user_id"`
			Name     string `json:"name"`
			Initials string `json:"initials"`
		} `json:"teachers"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if len(resp.Teachers) != 2 {
		t.Fatalf("want 2 teachers, got %d", len(resp.Teachers))
	}
	if resp.Teachers[0].Name != "Пётр Сидоров" || resp.Teachers[0].Initials != "ПС" {
		t.Errorf("teacher 0: %+v", resp.Teachers[0])
	}
}

func TestCenterTeachers_NonTeacherForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherCheck(mock, 3, 42, false)
	req := authedRequest(t, access, 3, false, http.MethodGet, "/centers/42/teachers", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rr.Code)
	}
}
