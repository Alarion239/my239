package middleware

import (
	"net/http"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/rs/cors"
)

// CORSMiddleware creates CORS middleware with appropriate settings
func CORSMiddleware() func(http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{config.FrontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false, // Not needed for Bearer tokens
		MaxAge:           300,
	})

	return c.Handler
}
