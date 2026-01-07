// Package migrate provides database migration functionality for PostgreSQL databases.
// It supports applying, rolling back, and stepping through migrations with transaction safety.
package migrate

import (
	"context"
	"database/sql"
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

func NewMigrator(ctx context.Context, connectionString string) (*Migrator, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	conn, err := pgx.Connect(ctx, connectionString)
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

	// Slice the array to only include valid migrations (0 to maxVersion)
	m.migrations = migrations[:maxVersion+1]
	return nil
}

func (m *Migrator) GetCurrentVersion(ctx context.Context) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, fmt.Errorf("context cancelled: %w", err)
	}

	var version sql.NullInt64 // Use NullInt64 to handle NULL from MAX()
	err := m.conn.QueryRow(ctx, "SELECT MAX(version) FROM migrations").Scan(&version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil // Table is empty, no migrations applied
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
			return 0, nil // Table doesn't exist yet, no migrations applied
		}
		return 0, fmt.Errorf("failed to get current migration version: %w", err)
	}

	// If MAX returns NULL (empty table), return 0
	if !version.Valid {
		return 0, nil
	}

	return int(version.Int64), nil
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

		fmt.Printf("Applying migration %d...\n", version)
		err = m.applyMigration(ctx, migration, true, currentVersion)
		if err != nil {
			return fmt.Errorf("failed to apply migration %d: %w", version, err)
		}
		fmt.Printf("Migration %d applied successfully\n", version)

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

	fmt.Printf("Rolling back migration %d...\n", currentVersion)
	err = m.applyMigration(ctx, *migrationToRollback, false, currentVersion)
	if err != nil {
		return err
	}
	fmt.Printf("Migration %d rolled back successfully\n", currentVersion)
	return nil
}

// applyMigration applies a single migration (up or down) within a transaction.
// It validates that SQL content is not empty before execution.
func (m *Migrator) applyMigration(ctx context.Context, migration Migration, up bool, currentVersion int) error {
	// Check context cancellation
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("context cancelled: %w", err)
	}

	var sql string

	if up {
		sql = migration.UpSQL
		if strings.TrimSpace(sql) == "" {
			return fmt.Errorf("migration %d has empty up.sql content", migration.Version)
		}
	} else {
		sql = migration.DownSQL
		if strings.TrimSpace(sql) == "" {
			return fmt.Errorf("migration %d has empty down.sql content", migration.Version)
		}
	}

	// Start transaction
	tx, err := m.conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Execute migration SQL - split by semicolon and execute each statement separately
	// This ensures each statement is executed properly even if they contain complex SQL
	statements := strings.Split(sql, ";")
	for i, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue // Skip empty statements
		}
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("failed to execute migration SQL for version %d (statement %d): %w\nStatement: %s", migration.Version, i+1, err, stmt)
		}
	}

	// Update migrations table based on direction
	if up {
		// Insert the version when applying a migration (idempotent with ON CONFLICT DO NOTHING)
		if _, err := tx.Exec(ctx,
			"INSERT INTO migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
			migration.Version, // The version being applied
		); err != nil {
			return fmt.Errorf("failed to record migration version %d: %w", migration.Version, err)
		}
	} else {
		// Delete the version when rolling back a migration
		if _, err := tx.Exec(ctx,
			"DELETE FROM migrations WHERE version = $1",
			migration.Version, // The version being rolled back (same as currentVersion)
		); err != nil {
			return fmt.Errorf("failed to remove migration version %d: %w", migration.Version, err)
		}
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
