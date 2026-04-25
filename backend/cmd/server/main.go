package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/config"
	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/internal/handlers/health"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/ratelimit"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	writeTimeout      = 15 * time.Second
	idleTimeout       = 60 * time.Second
	shutdownTimeout   = 15 * time.Second
)

func main() {
	if err := run(); err != nil {
		logger.LogError("server exited with error", err)
		os.Exit(1)
	}
}

func run() error {
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger.Init()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	database, err := db.NewDB(rootCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	tokens, err := auth.NewTokenService(auth.TokenServiceConfig{
		AccessConfig: &auth.AccessTokenConfig{
			Secret:     cfg.JWT.Secret,
			Issuer:     cfg.JWT.Issuer,
			Audience:   cfg.JWT.Audience,
			Expiration: cfg.JWT.AccessTTL,
		},
		RefreshConfig: &auth.RefreshTokenConfig{
			DB:         database,
			Expiration: cfg.JWT.RefreshTTL,
		},
	})
	if err != nil {
		return err
	}

	limiter, err := buildLimiter(rootCtx, cfg)
	if err != nil {
		return err
	}

	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(chiMiddleware.Recoverer)
	r.Use(middleware.LoggerMiddleware)
	r.Use(middleware.SecurityHeadersMiddleware)
	r.Use(middleware.CORSMiddleware(cfg.FrontendURL))

	r.Get("/healthz", health.Live())
	r.Get("/readyz", health.Ready(database))

	r.Route("/api/v1", func(r chi.Router) {
		r.Mount("/auth", authHandlers.Router(database, tokens, limiter))
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.LogInfo("server listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		return err
	case <-rootCtx.Done():
		logger.LogInfo("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.LogError("graceful shutdown failed, forcing close", err)
		_ = srv.Close()
		return err
	}
	logger.LogInfo("server stopped cleanly")
	return nil
}

// buildLimiter chooses the Redis-backed limiter when REDIS_URL is set and
// reachable, otherwise falls back to the in-process Memory limiter. We log
// the choice so it's visible in startup logs.
func buildLimiter(ctx context.Context, cfg *config.Config) (ratelimit.Limiter, error) {
	if cfg.RedisURL == "" {
		logger.LogInfo("rate limiter: in-memory (REDIS_URL not set)")
		return ratelimit.NewMemory(), nil
	}

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opt)

	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		// Hard fail at startup: if the operator configured Redis, they want
		// distributed rate limiting; silently falling back would mask
		// misconfigurations. Close the client we just opened so we don't leak
		// the underlying TCP connections on the way out.
		_ = client.Close()
		return nil, err
	}
	logger.LogInfo("rate limiter: redis", "url", cfg.RedisURL)
	return ratelimit.NewRedis(client, "ratelimit"), nil
}
