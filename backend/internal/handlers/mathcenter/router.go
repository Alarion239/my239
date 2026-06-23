// Package mathcenter exposes the /api/v1/mathcenter HTTP surface.
package mathcenter

import (
	"time"

	"github.com/go-chi/chi/v5"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Router mounts the math center routes. All endpoints require an authenticated
// user; role-based visibility (teacher vs student) is decided in the handler.
// blobs is used by the series PDF endpoints; uploadTTL signs PUT URLs the
// client uses to upload directly to Yandex; downloadTTL signs GET URLs for
// the redirect download.
func Router(database *db.DB, hub *live.Hub, tokens *internalAuth.TokenService, blobs objectstore.Store, uploadTTL, downloadTTL time.Duration) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))
	// Act-as impersonation runs right after auth: an admin may carry the
	// X-Act-As-User-Id header to view/operate as any user (including /me here).
	r.Use(middleware.ImpersonationMiddleware(database))

	r.Get("/me", Me(database))

	// Live SSE stream of center-change signals (grading/coffins/membership).
	r.Get("/centers/{centerID}/events", Events(hub, database))

	r.Route("/centers/{centerID}/series", func(r chi.Router) {
		r.Get("/", ListSeriesForCenter(database))
		r.Post("/", CreateSeries(database))
	})
	// Center-wide coffins ("Гробы") tab.
	r.Get("/centers/{centerID}/coffins", ListCenterCoffins(database))
	r.Get("/centers/{centerID}/coffin-queue", ListCoffinQueue(database))
	// Head-teacher self-service management panel ("Управление").
	r.Mount("/centers/{centerID}/manage", ManageRouter(database, hub))
	// Teacher-facing student profile + internal teacher-only notes on a student
	// (any teacher of the center reads/writes; author-or-admin edits/deletes).
	r.Route("/centers/{centerID}/students/{studentUserID}", func(r chi.Router) {
		r.Get("/", GetStudentProfile(database))
		r.Get("/notes", ListStudentNotes(database))
		r.Post("/notes", CreateStudentNote(database))
		r.Patch("/notes/{noteID}", UpdateStudentNote(database))
		r.Delete("/notes/{noteID}", DeleteStudentNote(database))
	})
	// Group a set of subproblems under one shared разбор (teacher).
	r.Post("/subproblem-solutions/group", AssignSolutionGroup(database))

	r.Route("/series/{seriesID}", func(r chi.Router) {
		r.Get("/", GetSeries(database))
		r.Put("/", UpdateSeries(database))
		r.Delete("/", DeleteSeries(database, blobs))
		r.Post("/pdf/upload-url", IssuePDFUploadURL(database, blobs, uploadTTL))
		r.Post("/pdf/publish", FinalizePDFPublish(database, blobs))
		r.Get("/pdf", DownloadSeriesPDF(database, blobs, downloadTTL))
		r.Get("/tex", GetSeriesTex(database))
		r.Put("/tex", PutSeriesTex(database))
		r.Delete("/tex", DeleteSeriesTex(database))
	})

	// Per-subproblem coffins ("гробы") + официальный «Разбор». The subproblem is
	// the unit: mark/unmark/release + разбор (TeX/PDF/link) all key on it.
	r.Route("/subproblems/{subproblemID}", func(r chi.Router) {
		r.Post("/coffin", MarkCoffin(database, hub))
		r.Delete("/coffin", UnmarkCoffin(database, hub, blobs))
		r.Post("/solution/release", ReleaseCoffin(database, hub))
		r.Get("/solution/tex", GetSubproblemSolutionTex(database))
		r.Put("/solution/tex", PutSubproblemSolutionTex(database, hub))
		r.Post("/solution/pdf/upload-url", IssueSubproblemSolutionPDFUploadURL(database, blobs, uploadTTL))
		r.Post("/solution/pdf/publish", FinalizeSubproblemSolutionPDFPublish(database, hub, blobs))
		r.Get("/solution/pdf", DownloadSubproblemSolutionPDF(database, blobs, downloadTTL))
		r.Put("/solution/link", SetSubproblemSolutionLinkHandler(database, hub))
	})
	return r
}
