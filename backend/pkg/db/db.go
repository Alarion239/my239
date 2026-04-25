package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier is the minimal read/write surface used by repositories. It is
// satisfied by both a connection pool and a transaction, which lets a
// repository method participate in an outer transaction transparently.
type Querier interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Pool is the full pool surface, adding transaction + lifecycle methods on
// top of Querier. pgxpool.Pool and pgxmock satisfy it.
type Pool interface {
	Querier
	Begin(ctx context.Context) (pgx.Tx, error)
	Ping(ctx context.Context) error
	Close()
}

// DB represents a database connection pool and must be initialized using NewDB.
type DB struct {
	pool Pool
}

// NewDB creates and initializes a new DB instance with a connection pool.
func NewDB(ctx context.Context, connectionString string) (*DB, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	pool, err := pgxpool.New(ctx, connectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{pool: pool}, nil
}

// NewDBWithPool creates a DB from an existing Pool implementation.
// This is primarily useful for injecting mock pools during testing.
func NewDBWithPool(pool Pool) *DB {
	return &DB{pool: pool}
}

// Close gracefully closes the connection pool and releases all resources.
func (db *DB) Close() {
	if db.pool != nil {
		db.pool.Close()
	}
}

// Pool returns the Pool interface for direct database operations.
func (db *DB) Pool() Pool {
	return db.pool
}
