// Package homework exposes the /api/v1/homework HTTP surface: student
// submissions, grader queue/grade/retract, appeals, and the per-event
// presigned-PUT upload flow that lets clients send photos directly to
// Yandex Object Storage without proxying bytes through this service.
package homework

import (
	"time"

	"github.com/go-chi/chi/v5"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Router mounts the homework routes. All endpoints require an authenticated
// user; per-route role checks (student-of-center vs teacher-of-center vs
// admin) happen inside each handler against the math_center_* membership
// tables. uploadTTL is the lifetime of presigned PUT URLs (short — minutes);
// downloadTTL is for presigned GETs returned when serving photo URLs.
func Router(database *db.DB, hub *live.Hub, tokens *internalAuth.TokenService, blobs objectstore.Store, uploadTTL, downloadTTL time.Duration) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))
	// Act-as impersonation runs right after auth: an admin may carry the
	// X-Act-As-User-Id header to operate (read AND write) as any user.
	r.Use(middleware.ImpersonationMiddleware(database))

	// Student-target routes use the subproblem id (the thread doesn't
	// necessarily exist yet on first submit). The handlers find-or-create
	// the thread atomically.
	r.Route("/threads/{subproblemID}", func(r chi.Router) {
		r.Post("/upload-urls", IssueStudentUploadURLs(database, blobs, uploadTTL))
		r.Post("/submit", SubmitAttempt(database, hub, blobs))
		r.Post("/appeal", AppealGrade(database, hub, blobs))
	})

	// Grader-target routes operate on an existing thread by id. The
	// /by-id/ segment disambiguates the chi param from /threads/{subproblemID}.
	r.Route("/threads/by-id/{threadID}", func(r chi.Router) {
		r.Get("/", GetThread(database, blobs, downloadTTL))
		r.Post("/upload-urls", IssueGraderUploadURLs(database, blobs, uploadTTL))
		r.Post("/claim", Claim(database, hub, blobs))
		r.Post("/claim/heartbeat", Heartbeat(database))
		r.Post("/claim/release", Release(database, hub))
		r.Post("/grade", Grade(database, hub, blobs))
		r.Post("/retract", Retract(database, hub, blobs))

		// Internal teacher-only notes on the solution thread (never shown to
		// the student). Author-or-admin may edit/delete.
		r.Get("/notes", ListThreadNotes(database))
		r.Post("/notes", CreateThreadNote(database))
		r.Patch("/notes/{noteID}", UpdateThreadNote(database))
		r.Delete("/notes/{noteID}", DeleteThreadNote(database))
	})

	// Offline grading — teacher marks a solution explained in person, keyed
	// on (student, subproblem) since the thread may not exist yet. The
	// credited grader is resolved from the body (conduit) or defaults to the
	// authenticated teacher (phone flow).
	r.Post("/offline/accept", OfflineAccept(database, hub, blobs))
	r.Post("/offline/undo", OfflineUndo(database, hub, blobs))

	// Subproblem metadata — used by the new-submission page (when no
	// thread exists yet) to find the series due-date.
	r.Get("/subproblems/{subproblemID}", SubproblemContext(database))

	// Series-scoped views.
	r.Get("/series/{seriesID}/my", MySeriesRollup(database))
	r.Get("/series/{seriesID}/queue", GraderQueue(database))
	r.Get("/series/{seriesID}/grid", TeacherGrid(database))
	r.Get("/series/{seriesID}/problem-stats", ProblemStats(database))

	// Center-scoped dashboards.
	r.Get("/centers/{centerID}/grader-stats", GraderStats(database))
	r.Get("/centers/{centerID}/grid", GetCenterGrid(database))
	r.Get("/centers/{centerID}/teachers", CenterTeachers(database))

	return r
}
