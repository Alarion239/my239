// Package migrate provides database migration functionality for PostgreSQL databases.
// It supports applying, rolling back, and stepping through migrations with transaction safety.
package migrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	constants "github.com/Alarion239/my239/backend/internal/constants"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Migration struct {
	Version int
	UpSQL   string
	DownSQL string
}

type Migrator struct {
	conn       *pgx.Conn
	migrations []Migration
}

func NewMigrator(ctx context.Context) (*Migrator, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	connString := os.Getenv(constants.DATABASE_URL)
	if connString == "" {
		return nil, fmt.Errorf("%s environment variable is not set", constants.DATABASE_URL)
	}

	conn, err := pgx.Connect(ctx, connString)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	m := &Migrator{
		conn: conn,
	}

	// Load migrations from directory using constant
	err = m.loadMigrations()
	if err != nil {
		conn.Close(ctx)
		return nil, fmt.Errorf("failed to load migrations: %w", err)
	}

	return m, nil
}

func (m *Migrator) Close(ctx context.Context) error {
	return m.conn.Close(ctx)
}

func (m *Migrator) loadMigrations() error {
	entries, err := os.ReadDir(constants.MIGRATIONS_DIR)
	if err != nil {
		return fmt.Errorf("failed to read migrations directory %s: %w", constants.MIGRATIONS_DIR, err)
	}

	fileCount := len(entries)

	migrations := make([]Migration, fileCount/2+5) // Every migration has 2 files: up and down
	maxVersion := -1

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		baseName := entry.Name()
		if len(baseName) < 6 {
			continue
		}

		versionStr := baseName[:6]
		version, err := strconv.Atoi(versionStr)
		if err != nil {
			continue
		}

		var isUp bool
		switch {
		case strings.HasSuffix(baseName, ".up.sql"):
			isUp = true
		case strings.HasSuffix(baseName, ".down.sql"):
			isUp = false
		default:
			continue
		}

		if migrations[version] == (Migration{}) {
			migrations[version] = Migration{Version: version}
		}

		filePath := filepath.Join(constants.MIGRATIONS_DIR, baseName)
		data, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", filePath, err)
		}

		if isUp {
			migrations[version].UpSQL = string(data)
		} else {
			migrations[version].DownSQL = string(data)
		}

		if version > maxVersion {
			maxVersion = version
		}
	}

	if maxVersion == -1 {
		return fmt.Errorf("no valid migration files found in directory %s", constants.MIGRATIONS_DIR)
	}

	// Validate all migrations exist and have UpSQL
	for version := 0; version <= maxVersion; version++ {
		if migrations[version].UpSQL == "" {
			return fmt.Errorf("migration %d is missing up.sql file", version)
		}
	}

	m.migrations = migrations
	return nil
}

func (m *Migrator) GetCurrentVersion(ctx context.Context) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, fmt.Errorf("context cancelled: %w", err)
	}

	var version int
	err := m.conn.QueryRow(ctx, "SELECT version FROM migrations LIMIT 1").Scan(&version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil // Table is empty (shouldn't happen after migration 0, but handle gracefully)
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
			return 0, nil // Table doesn't exist yet, no migrations applied
		}
		return 0, fmt.Errorf("failed to get current migration version: %w", err)
	}
	return version, nil
}

// Up applies all pending migrations in order starting from currentVersion + 1.
func (m *Migrator) Up(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("context cancelled: %w", err)
	}

	currentVersion, err := m.GetCurrentVersion(ctx)
	if err != nil {
		return fmt.Errorf("failed to get current version before applying migrations: %w", err)
	}

	// Apply migrations starting from currentVersion + 1
	for version := currentVersion + 1; version < len(m.migrations); version++ {
		migration := m.migrations[version]

		// Check context cancellation before each migration
		err = ctx.Err()
		if err != nil {
			return fmt.Errorf("context cancelled while applying migration %d: %w", version, err)
		}

		err = m.applyMigration(ctx, migration, true, currentVersion)
		if err != nil {
			return fmt.Errorf("failed to apply migration %d: %w", version, err)
		}

		currentVersion = version
	}

	return nil
}

// Down rolls back the last migration.
// Returns an error if there are no migrations to rollback or if the migration doesn't have a down.sql file.
func (m *Migrator) Down(ctx context.Context) error {
	// Check context cancellation
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("context cancelled: %w", err)
	}

	currentVersion, err := m.GetCurrentVersion(ctx)
	if err != nil {
		return fmt.Errorf("failed to get current version before rolling back: %w", err)
	}

	if currentVersion == 0 {
		return errors.New("no migrations to rollback")
	}

	// Find the migration to rollback
	var migrationToRollback *Migration
	for i := len(m.migrations) - 1; i >= 0; i-- {
		if m.migrations[i].Version == currentVersion {
			migrationToRollback = &m.migrations[i]
			break
		}
	}

	if migrationToRollback == nil {
		return fmt.Errorf("migration %d not found in loaded migrations", currentVersion)
	}

	if strings.TrimSpace(migrationToRollback.DownSQL) == "" {
		return fmt.Errorf("migration %d does not have a down.sql file or it is empty", currentVersion)
	}

	return m.applyMigration(ctx, *migrationToRollback, false, currentVersion)
}

// applyMigration applies a single migration (up or down) within a transaction.
// It validates that SQL content is not empty before execution.
func (m *Migrator) applyMigration(ctx context.Context, migration Migration, up bool, currentVersion int) error {
	// Check context cancellation
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("context cancelled: %w", err)
	}

	var sql string
	var newVersion int

	if up {
		sql = migration.UpSQL
		newVersion = migration.Version
		if strings.TrimSpace(sql) == "" {
			return fmt.Errorf("migration %d has empty up.sql content", migration.Version)
		}
	} else {
		sql = migration.DownSQL
		if strings.TrimSpace(sql) == "" {
			return fmt.Errorf("migration %d has empty down.sql content", migration.Version)
		}
		// Previous version is currentVersion - 1 (migrations are sequential from 0)
		newVersion = currentVersion - 1
	}

	// Start transaction
	tx, err := m.conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Execute migration SQL
	if _, err := tx.Exec(ctx, sql); err != nil {
		return fmt.Errorf("failed to execute migration SQL for version %d: %w", migration.Version, err)
	}

	// Update version in migrations table using INSERT ... ON CONFLICT
	if _, err := tx.Exec(ctx,
		"INSERT INTO migrations (version) VALUES ($1) ON CONFLICT (version) DO UPDATE SET version = $1",
		newVersion,
	); err != nil {
		return fmt.Errorf("failed to update migration version to %d: %w", newVersion, err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Steps applies or rolls back a specific number of migrations.
// Positive steps apply migrations forward, negative steps roll back migrations.
func (m *Migrator) Steps(ctx context.Context, steps int) error {
	// Check context cancellation
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("context cancelled: %w", err)
	}

	currentVersion, err := m.GetCurrentVersion(ctx)
	if err != nil {
		return fmt.Errorf("failed to get current version before executing steps: %w", err)
	}

	if steps > 0 {
		// Apply migrations forward starting from currentVersion + 1
		for i := 0; i < steps && currentVersion+1+i < len(m.migrations); i++ {
			version := currentVersion + 1 + i
			migration := m.migrations[version]

			// Check context cancellation before each migration
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("context cancelled while applying migration %d: %w", version, err)
			}

			if err := m.applyMigration(ctx, migration, true, currentVersion); err != nil {
				return fmt.Errorf("failed to apply migration %d: %w", version, err)
			}

			currentVersion = version
		}
	} else if steps < 0 {
		// Rollback migrations
		rollbackCount := -steps
		for i := 0; i < rollbackCount; i++ {
			if currentVersion == 0 {
				return errors.New("no migrations to rollback")
			}

			// Check context cancellation before each rollback
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("context cancelled while rolling back migration %d: %w", currentVersion, err)
			}

			// Find the migration to rollback
			var migrationToRollback *Migration
			for j := len(m.migrations) - 1; j >= 0; j-- {
				if m.migrations[j].Version == currentVersion {
					migrationToRollback = &m.migrations[j]
					break
				}
			}

			if migrationToRollback == nil {
				return fmt.Errorf("migration %d not found in loaded migrations", currentVersion)
			}

			if strings.TrimSpace(migrationToRollback.DownSQL) == "" {
				return fmt.Errorf("migration %d does not have a down.sql file or it is empty", currentVersion)
			}

			if err := m.applyMigration(ctx, *migrationToRollback, false, currentVersion); err != nil {
				return fmt.Errorf("failed to rollback migration %d: %w", currentVersion, err)
			}

			// Previous version is currentVersion - 1 (migrations are sequential from 0)
			currentVersion = migrationToRollback.Version - 1
		}
	}

	return nil
}
