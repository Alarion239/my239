package middleware

import (
	"net/http"

	"github.com/rs/cors"
)

// CORSMiddleware allows browser requests from the configured frontend origin.
//
// AllowCredentials is intentionally false: the API uses Bearer tokens, so
// cookies don't need to traverse origins. Keeping it false also lets us pin
// AllowedOrigins to a single host without the wildcard restrictions that come
// with credentialed CORS.
func CORSMiddleware(frontendURL string) func(http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{frontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Act-As-User-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	})

	return c.Handler
}
