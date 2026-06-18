// Package main is the API server entrypoint: it loads config, wires the
// dependency graph (db, auth, rate limiter, object store), mounts the chi
// router and middleware, and runs the HTTP server with graceful shutdown.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/bootstrap"
	"github.com/Alarion239/my239/backend/internal/config"
	adminHandlers "github.com/Alarion239/my239/backend/internal/handlers/admin"
	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/internal/handlers/health"
	hwHandlers "github.com/Alarion239/my239/backend/internal/handlers/homework"
	mcHandlers "github.com/Alarion239/my239/backend/internal/handlers/mathcenter"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/metrics"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/Alarion239/my239/backend/pkg/objectstore"
	"github.com/Alarion239/my239/backend/pkg/ratelimit"
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

	database, err := db.New(rootCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	// On a fresh deployment (zero users) mint a single-use invitation token so
	// the operator can register the first admin. Non-fatal: the users table may
	// not exist yet if migrations haven't run, and that must not stop serving.
	if err := bootstrap.EnsureAdminInviteToken(rootCtx, store.New(database.Pool())); err != nil {
		logger.LogError("bootstrap admin token", err)
	}

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

	blobs, err := buildObjectStore(rootCtx, cfg)
	if err != nil {
		return err
	}

	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(middleware.RealIPMiddleware)
	r.Use(chiMiddleware.Recoverer)
	r.Use(middleware.LoggerMiddleware)
	r.Use(middleware.SecurityHeadersMiddleware)
	r.Use(middleware.CORSMiddleware(cfg.FrontendURL))

	r.Get("/healthz", health.Live())
	r.Get("/readyz", health.Ready(database))
	r.Handle("/metrics", metrics.Handler())

	r.Route("/api/v1", func(r chi.Router) {
		r.Mount("/auth", authHandlers.Router(database, tokens, limiter))
		r.Mount("/admin", adminHandlers.Router(database, tokens))
		r.Mount("/mathcenter", mcHandlers.Router(database, tokens, blobs, cfg.S3.UploadTTL, cfg.S3.DownloadTTL))
		r.Mount("/homework", hwHandlers.Router(database, tokens, blobs, cfg.S3.UploadTTL, cfg.S3.DownloadTTL))
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

// buildObjectStore picks the S3-backed store when S3_BUCKET is set, otherwise
// the in-memory one. Mirrors the limiter's "configured → real, otherwise
// fallback" pattern so local dev needs zero S3 setup.
func buildObjectStore(ctx context.Context, cfg *config.Config) (objectstore.Store, error) {
	if cfg.S3.Bucket == "" {
		logger.LogInfo("object store: in-memory (S3_BUCKET not set)")
		return objectstore.NewMemory(), nil
	}
	store, err := objectstore.NewS3(ctx, objectstore.S3Config{
		Endpoint:        cfg.S3.Endpoint,
		PublicEndpoint:  cfg.S3.PublicEndpoint,
		Region:          cfg.S3.Region,
		Bucket:          cfg.S3.Bucket,
		AccessKeyID:     cfg.S3.AccessKeyID,
		SecretAccessKey: cfg.S3.SecretAccessKey,
		UsePathStyle:    cfg.S3.UsePathStyle,
	})
	if err != nil {
		return nil, err
	}
	logger.LogInfo("object store: s3",
		"endpoint", cfg.S3.Endpoint,
		"public_endpoint", cfg.S3.PublicEndpoint,
		"bucket", cfg.S3.Bucket,
	)
	return store, nil
}
