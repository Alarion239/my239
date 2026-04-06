package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/config"
	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	logger.Init()

	cfg, err := config.Load()
	if err != nil {
		logger.LogError("Failed to load config", err)
		os.Exit(1)
	}

	database, err := db.NewDB(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.LogError("Failed to initialize database", err)
		os.Exit(1)
	}
	defer database.Close()

	jwtSvc := auth.NewJWTService(cfg.JWTSecret, cfg.JWTExpirationHours)

	r := chi.NewRouter()

	// Global middleware — applied to every request in order
	r.Use(chiMiddleware.RealIP)                       // trust X-Forwarded-For / X-Real-IP headers
	r.Use(chiMiddleware.Recoverer)                    // catch panics, return 500 instead of crashing
	r.Use(middleware.LoggerMiddleware)                // structured slog request logging
	r.Use(middleware.SecurityHeadersMiddleware)       // X-Frame-Options, CSP, etc.
	r.Use(middleware.CORSMiddleware(cfg.FrontendURL)) // rs/cors

	r.Mount("/api/v1/auth", authHandlers.Router(database, jwtSvc))

	logger.LogInfo("Server starting", "port", cfg.Port)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.LogError("Server failed", err)
			cancel()
		}
	}()

	<-ctx.Done()
	logger.LogInfo("Server shutting down gracefully...")
}
