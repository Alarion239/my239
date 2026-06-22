package seed_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Alarion239/my239/backend/internal/seed"
)

// TestSeedRun_Integration runs the real seeder against a Postgres pointed to by
// TEST_DATABASE_URL (migrated schema). Skipped when unset, so `go test ./...`
// stays hermetic. Runs twice to prove reset-then-reseed is idempotent.
func TestSeedRun_Integration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run the seeder integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	for run := 1; run <= 2; run++ {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("run %d: begin: %v", run, err)
		}
		res, err := seed.Run(ctx, tx)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("run %d: seed: %v", run, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("run %d: commit: %v", run, err)
		}

		if res.Groups != 3 || res.Teachers != 12 || res.Students != 90 {
			t.Errorf("run %d: roster = groups %d, teachers %d, students %d; want 3/12/90",
				run, res.Groups, res.Teachers, res.Students)
		}
		if res.Series != 10 || res.Problems != 30 || res.Subproblems != 42 {
			t.Errorf("run %d: structure = series %d, problems %d, subproblems %d; want 10/30/42",
				run, res.Series, res.Problems, res.Subproblems)
		}
		if res.Submissions == 0 {
			t.Errorf("run %d: no submissions seeded", run)
		}
		if res.Coffins == 0 {
			t.Errorf("run %d: no coffins created; the difficulty gradient should leave some", run)
		}
		if res.Password != seed.DemoPassword {
			t.Errorf("run %d: password = %q, want %q", run, res.Password, seed.DemoPassword)
		}
	}
}
