package db

import (
	"context"
	"fmt"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

// NewDB creates and initializes a new DB instance with a connection pool.
func NewDB(ctx context.Context, connectionString string) (*DB, error) {
	if err := ctx.Err(); err != nil {

		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	pool, err := pgxpool.New(ctx, connectionString)
	if err != nil {
		logger.LogError("Failed to create connection pool", err)
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Verify the connection pool works by pinging the database
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		logger.LogError("Failed to ping database", err)
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{
		pool: pool,
	}, nil
}

// Close gracefully closes the connection pool and releases all resources.
func (db *DB) Close() {
	if db.pool != nil {
		db.pool.Close()
	}
}

// Pool returns the underlying pgxpool.Pool for direct access when needed.
func (db *DB) Pool() *pgxpool.Pool {
	return db.pool
}
