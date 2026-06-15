// Package migrate is a thin wrapper around golang-migrate that hides the
// driver wiring (embedded SQL files, pgx/v5 database driver) and exposes a
// small Go interface the rest of the codebase can depend on without pulling
// the migrate types into every caller.
//
// We use golang-migrate (rather than goose) because the existing
// {version}_{name}.up.sql / .down.sql layout already matches what it expects,
// it has the most-used CLI binary if we ever need direct ops access, and the
// embed.FS source driver gives us a self-contained binary.
package migrate

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/Alarion239/my239/backend/migrations"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // register the pgx/v5 migrate driver
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Migrator is the user-facing interface. Implemented by *golangMigrator (real)
// and easy to mock in tests.
type Migrator interface {
	// Up applies all pending migrations.
	Up(ctx context.Context) error
	// Down rolls back the most recently applied migration.
	Down(ctx context.Context) error
	// Steps applies (positive) or rolls back (negative) the given number of
	// migrations.
	Steps(ctx context.Context, n int) error
	// Version returns the current applied version, whether the schema is
	// dirty (a migration failed mid-way), and ErrNoVersion if no migrations
	// have been applied.
	Version(ctx context.Context) (version uint, dirty bool, err error)
	// Close releases the underlying resources.
	Close() error
}

// ErrNoVersion is returned by Version when no migration has been applied yet.
var ErrNoVersion = errors.New("no migration version recorded")

// New constructs a Migrator backed by golang-migrate, reading migration files
// from the embedded filesystem.
//
// On the happy path the source driver's lifetime is taken over by the returned
// *migrate.Migrate (closed via golangMigrator.Close). On any error path before
// hand-off, we close srcDriver explicitly to avoid leaking the embed.FS reader.
func New(dbURL string) (Migrator, error) {
	srcDriver, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return nil, fmt.Errorf("init migration source: %w", err)
	}

	url, err := toPgxURL(dbURL)
	if err != nil {
		_ = srcDriver.Close()
		return nil, err
	}

	m, err := migrate.NewWithSourceInstance("iofs", srcDriver, url)
	if err != nil {
		_ = srcDriver.Close()
		return nil, fmt.Errorf("init migrator: %w", err)
	}
	return &golangMigrator{m: m}, nil
}

// toPgxURL ensures the connection string uses the pgx5:// scheme that the
// golang-migrate pgx/v5 driver registers under.
func toPgxURL(dbURL string) (string, error) {
	switch {
	case strings.HasPrefix(dbURL, "pgx5://"):
		return dbURL, nil
	case strings.HasPrefix(dbURL, "postgres://"):
		return "pgx5://" + strings.TrimPrefix(dbURL, "postgres://"), nil
	case strings.HasPrefix(dbURL, "postgresql://"):
		return "pgx5://" + strings.TrimPrefix(dbURL, "postgresql://"), nil
	default:
		return "", fmt.Errorf("unsupported database URL scheme; expected postgres:// or pgx5://")
	}
}

// golangMigrator is the real Migrator. It exists only to translate
// golang-migrate's typed sentinels into our package's sentinels and to
// shield callers from migrate.ErrNoChange noise.
var _ Migrator = (*golangMigrator)(nil)

type golangMigrator struct {
	m *migrate.Migrate
}

func (g *golangMigrator) Up(_ context.Context) error {
	return ignoreNoChange(g.m.Up())
}

func (g *golangMigrator) Down(_ context.Context) error {
	// Use Steps(-1) instead of Down(): Down() rolls back ALL migrations,
	// which is virtually never what you want in production.
	return ignoreNoChange(g.m.Steps(-1))
}

func (g *golangMigrator) Steps(_ context.Context, n int) error {
	if n == 0 {
		return nil
	}
	return ignoreNoChange(g.m.Steps(n))
}

func (g *golangMigrator) Version(_ context.Context) (uint, bool, error) {
	v, dirty, err := g.m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return 0, false, ErrNoVersion
	}
	if err != nil {
		return 0, false, err
	}
	return v, dirty, nil
}

func (g *golangMigrator) Close() error {
	srcErr, dbErr := g.m.Close()
	if srcErr != nil {
		return srcErr
	}
	return dbErr
}

// ignoreNoChange folds migrate.ErrNoChange into nil — getting "no change" is
// the desired outcome of an idempotent up/down call, not an error.
func ignoreNoChange(err error) error {
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}
