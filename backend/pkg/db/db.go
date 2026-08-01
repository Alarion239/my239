// Package db wraps a pgx connection pool behind small Querier/Pool interfaces
// so repositories can run against either the pool or a transaction, and tests
// can inject a mock pool.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Alarion239/my239/backend/internal/logger"
)

// Pool tuning defaults. They are applied unless the connection string already
// overrides them (pgx reads pool_max_conns, pool_min_conns, etc. from the URL),
// so a deployment can size MaxConns to its Postgres connection budget via
// DATABASE_URL query params without code changes.
const (
	defaultMaxConns        = 10
	defaultMinConns        = 2
	defaultMaxConnLifetime = 30 * time.Minute
	defaultMaxConnIdleTime = 5 * time.Minute
	defaultHealthCheck     = time.Minute
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
	BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	Ping(ctx context.Context) error
	Close()
}

// DB represents a database connection pool and must be initialized using New.
type DB struct {
	pool Pool
}

// New creates and initializes a new DB instance with a tuned connection pool.
//
// The pool gets explicit lifetime, idle-timeout and health-check settings
// (pgx leaves these at zero by default, which never recycles connections —
// a problem behind PgBouncer or managed Postgres that drops idle backends).
// MaxConns/MinConns fall back to sane defaults but defer to anything the
// connection string already specifies.
func New(ctx context.Context, connectionString string) (*DB, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	cfg, err := pgxpool.ParseConfig(connectionString)
	if err != nil {
		return nil, fmt.Errorf("parse connection string: %w", err)
	}
	if err := applyPoolDefaults(connectionString, cfg); err != nil {
		return nil, err
	}
	logger.LogInfo("database pool configured",
		"max_conns", cfg.MaxConns,
		"min_conns", cfg.MinConns,
		"max_conn_lifetime", cfg.MaxConnLifetime.String(),
		"max_conn_idle_time", cfg.MaxConnIdleTime.String(),
		"health_check_period", cfg.HealthCheckPeriod.String(),
	)

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{pool: pool}, nil
}

// applyPoolDefaults replaces pgxpool's host-dependent defaults only when the
// connection string did not explicitly provide a pool_* setting. Parsing the
// raw pgx config lets us distinguish an explicit zero from an omitted value;
// checking cfg fields after pgxpool.ParseConfig cannot do that because pgx has
// already filled its defaults.
func applyPoolDefaults(connectionString string, cfg *pgxpool.Config) error {
	raw, err := pgx.ParseConfig(connectionString)
	if err != nil {
		return fmt.Errorf("parse pool options: %w", err)
	}
	params := raw.Config.RuntimeParams
	if _, ok := params["pool_max_conns"]; !ok {
		cfg.MaxConns = defaultMaxConns
	}
	if _, ok := params["pool_min_conns"]; !ok {
		cfg.MinConns = defaultMinConns
	}
	if _, ok := params["pool_max_conn_lifetime"]; !ok {
		cfg.MaxConnLifetime = defaultMaxConnLifetime
	}
	if _, ok := params["pool_max_conn_idle_time"]; !ok {
		cfg.MaxConnIdleTime = defaultMaxConnIdleTime
	}
	if _, ok := params["pool_health_check_period"]; !ok {
		cfg.HealthCheckPeriod = defaultHealthCheck
	}
	return nil
}

// NewWithPool creates a DB from an existing Pool implementation.
// This is primarily useful for injecting mock pools during testing.
func NewWithPool(pool Pool) *DB {
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

// Raw returns the concrete *pgxpool.Pool when the underlying pool is one (it is
// in production; tests inject mocks and get nil). Used by the LISTEN/NOTIFY
// listener, which needs a hijacked connection (Acquire) outside the Querier
// surface.
func (db *DB) Raw() *pgxpool.Pool {
	p, _ := db.pool.(*pgxpool.Pool)
	return p
}
