// Package mathcenter exposes the /api/v1/mathcenter HTTP surface.
package mathcenter

import (
	"time"

	"github.com/go-chi/chi/v5"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

// Router mounts the math center routes. All endpoints require an authenticated
// user; role-based visibility (teacher vs student) is decided in the handler.
// blobs is used by the series PDF endpoints; uploadTTL signs PUT URLs the
// client uses to upload directly to Yandex; downloadTTL signs GET URLs for
// the redirect download.
func Router(database *db.DB, tokens *internalAuth.TokenService, blobs objectstore.Store, uploadTTL, downloadTTL time.Duration) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(tokens.Access()))

	r.Get("/me", Me(database))

	r.Route("/centers/{centerID}/series", func(r chi.Router) {
		r.Get("/", ListSeriesForCenter(database))
		r.Post("/", CreateSeries(database))
	})
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
	return r
}
