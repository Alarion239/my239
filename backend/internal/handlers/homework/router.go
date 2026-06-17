// Package homework exposes the /api/v1/homework HTTP surface: student
// submissions, grader queue/grade/retract, appeals, and the per-event
// presigned-PUT upload flow that lets clients send photos directly to
// Yandex Object Storage without proxying bytes through this service.
package homework

import (
	"time"

	"github.com/go-chi/chi/v5"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Router mounts the homework routes. All endpoints require an authenticated
// user; per-route role checks (student-of-center vs teacher-of-center vs
// admin) happen inside each handler against the math_center_* membership
// tables. uploadTTL is the lifetime of presigned PUT URLs (short — minutes);
// downloadTTL is for presigned GETs returned when serving photo URLs.
func Router(database *db.DB, tokens *internalAuth.TokenService, blobs objectstore.Store, uploadTTL, downloadTTL time.Duration) chi.Router {
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
		r.Post("/submit", SubmitAttempt(database, blobs))
		r.Post("/appeal", AppealGrade(database, blobs))
	})

	// Grader-target routes operate on an existing thread by id. The
	// /by-id/ segment disambiguates the chi param from /threads/{subproblemID}.
	r.Route("/threads/by-id/{threadID}", func(r chi.Router) {
		r.Get("/", GetThread(database, blobs, downloadTTL))
		r.Post("/upload-urls", IssueGraderUploadURLs(database, blobs, uploadTTL))
		r.Post("/claim", Claim(database, blobs))
		r.Post("/claim/heartbeat", Heartbeat(database))
		r.Post("/claim/release", Release(database))
		r.Post("/grade", Grade(database, blobs))
		r.Post("/retract", Retract(database, blobs))
	})

	// Subproblem metadata — used by the new-submission page (when no
	// thread exists yet) to find the series due-date.
	r.Get("/subproblems/{subproblemID}", SubproblemContext(database))

	// Series-scoped views.
	r.Get("/series/{seriesID}/my", MySeriesRollup(database))
	r.Get("/series/{seriesID}/queue", GraderQueue(database))
	r.Get("/series/{seriesID}/grid", TeacherGrid(database))

	// Center-scoped dashboards.
	r.Get("/centers/{centerID}/grader-stats", GraderStats(database))
	r.Get("/centers/{centerID}/grid", GetCenterGrid(database))

	return r
}
