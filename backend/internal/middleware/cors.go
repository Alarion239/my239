package middleware

import (
	"net/http"

	"github.com/rs/cors"
)

// CORSMiddleware creates CORS middleware with appropriate settings
func CORSMiddleware(frontendURL string) func(http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{frontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false, // Not needed for Bearer tokens
		MaxAge:           300,
	})

	return c.Handler
}
