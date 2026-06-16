// Package main is the migrate CLI. It applies, rolls back, and reports the
// status of database migrations defined in backend/migrations and embedded
// into the binary.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/pkg/migrate"
)

func main() {
	os.Exit(run())
}

// run does the work and returns the process exit code, so the deferred
// migrator Close runs before the process exits — os.Exit in main would skip it.
func run() int {
	if len(os.Args) < 2 {
		printUsage()
		return 1
	}

	command := os.Args[1]
	if command == "help" || command == "-h" || command == "--help" {
		printUsage()
		return 0
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		logger.LogError("DATABASE_URL environment variable is required", nil)
		return 1
	}

	ctx := context.Background()

	m, err := migrate.New(dbURL)
	if err != nil {
		logger.LogError("init migrator", err)
		return 1
	}
	defer func() {
		if cerr := m.Close(); cerr != nil {
			logger.LogError("close migrator", cerr)
		}
	}()

	switch command {
	case "up":
		if err := m.Up(ctx); err != nil {
			logger.LogError("apply migrations", err)
			return 1
		}
		fmt.Println("✓ all migrations applied")
	case "down":
		if err := m.Down(ctx); err != nil {
			logger.LogError("rollback migration", err)
			return 1
		}
		fmt.Println("✓ migration rolled back")
	case "steps":
		if len(os.Args) < 3 {
			_, _ = fmt.Fprintln(os.Stderr, "Error: 'steps' requires a number")
			return 1
		}
		n, err := strconv.Atoi(os.Args[2])
		if err != nil {
			logger.LogError("invalid steps argument", err)
			return 1
		}
		if err := m.Steps(ctx, n); err != nil {
			logger.LogError("steps", err)
			return 1
		}
		fmt.Printf("✓ %d step(s) applied\n", n)
	case "version", "status":
		v, dirty, err := m.Version(ctx)
		if errors.Is(err, migrate.ErrNoVersion) {
			fmt.Println("no migrations applied yet")
			return 0
		}
		if err != nil {
			logger.LogError("version", err)
			return 1
		}
		state := "clean"
		if dirty {
			state = "DIRTY (a migration failed mid-way; manual intervention required)"
		}
		fmt.Printf("current version: %d (%s)\n", v, state)
	default:
		_, _ = fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", command)
		printUsage()
		return 1
	}
	return 0
}

func printUsage() {
	fmt.Print(`Usage: migrate <command>

Commands:
  up                  Apply all pending migrations
  down                Roll back the most recently applied migration
  steps <n>           Apply (positive n) or roll back (negative n) n migrations
  version, status     Show current migration version and dirty flag
  help                Show this help message

Environment:
  DATABASE_URL        Postgres connection URL (postgres://, postgresql://, or pgx5://)

Examples:
  migrate up
  migrate down
  migrate steps 2
  migrate steps -1
  migrate version
`)
}
