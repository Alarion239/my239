package main

import (
	"context"
	"fmt"
	"os"
	"strconv"

	constants "github.com/Alarion239/my239/backend/internal/constants"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/pkg/migrate"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	ctx := context.Background()

	connectionString := os.Getenv(constants.DATABASE_URL)
	if connectionString == "" {
		logger.LogError("DATABASE_URL environment variable is not set", nil)
		os.Exit(1)
	}
	migrator, err := migrate.NewMigrator(ctx, connectionString)
	if err != nil {
		logger.LogError("Failed to create migrator", err)
		os.Exit(1)
	}
	defer migrator.Close(ctx)

	switch command {
	case "up":
		handleUp(ctx, migrator)
	case "down":
		handleDown(ctx, migrator)
	case "steps":
		handleSteps(ctx, migrator, os.Args[2:])
	case "version", "status":
		handleVersion(ctx, migrator)
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", command)
		printUsage()
		os.Exit(1)
	}
}

func handleUp(ctx context.Context, migrator *migrate.Migrator) {
	logger.LogInfo("Applying migrations...")
	if err := migrator.Up(ctx); err != nil {
		logger.LogError("Failed to apply migrations", err)
		os.Exit(1)
	}
	logger.LogInfo("Migrations applied successfully!")
}

func handleDown(ctx context.Context, migrator *migrate.Migrator) {
	fmt.Println("Rolling back migration...")
	if err := migrator.Down(ctx); err != nil {
		logger.LogError("Failed to rollback migration", err)
		os.Exit(1)
	}
	fmt.Println("Migration rolled back successfully!")
}

func handleSteps(ctx context.Context, migrator *migrate.Migrator, args []string) {
	if len(args) < 1 {
		fmt.Fprintf(os.Stderr, "Error: 'steps' command requires a number argument\n")
		os.Exit(1)
	}

	steps, err := strconv.Atoi(args[0])
	if err != nil {
		logger.LogError("Invalid number", err)
		os.Exit(1)
	}

	if err := migrator.Steps(ctx, steps); err != nil {
		logger.LogError("Failed to execute steps", err)
		os.Exit(1)
	}
}

func handleVersion(ctx context.Context, migrator *migrate.Migrator) {
	version, err := migrator.GetCurrentVersion(ctx)
	if err != nil {
		logger.LogError("Failed to get current version", err)
		os.Exit(1)
	}

	fmt.Printf("Current migration version: %d\n", version)
}

func printUsage() {
	fmt.Fprintf(os.Stdout, `Usage: migrate <command>

Commands:
  up                  Apply all pending migrations
  down                Rollback the last migration
  steps <number>      Apply or rollback specific number of migrations
                      (positive for up, negative for down)
  version, status     Show current migration version
  help                Show this help message

Environment Variables:
  %s        Database connection URL

Examples:
  migrate up
  migrate down
  migrate steps 2
  migrate steps -1
  migrate version
`, constants.DATABASE_URL)
}
