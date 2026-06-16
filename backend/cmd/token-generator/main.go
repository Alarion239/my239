// Package main is the invitation-token generator CLI. Admin-only — talks
// directly to the database to create / list / revoke invitation tokens that
// are required for new-user registration.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func main() {
	os.Exit(run())
}

// run does the work and returns the process exit code, so deferred cleanup
// (closing the pool) runs before the process exits — os.Exit in main would
// skip it.
func run() int {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Print("DATABASE_URL environment variable is required")
		return 1
	}
	if len(os.Args) < 2 {
		printUsage()
		return 1
	}

	database, err := db.New(context.Background(), dbURL)
	if err != nil {
		log.Printf("Failed to initialize database: %v", err)
		return 1
	}
	defer database.Close()

	q := store.New(database.Pool())
	ctx := context.Background()

	switch os.Args[1] {
	case "create":
		createToken(ctx, q)
	case "list":
		listTokens(ctx, database, q)
	case "revoke":
		revokeToken(ctx, q)
	default:
		fmt.Printf("Unknown command: %s\n", os.Args[1])
		printUsage()
		return 1
	}
	return 0
}

func printUsage() {
	fmt.Println(`Token Generator CLI

Usage:
  token-generator create --max-uses=<n> --expires=<duration> --description=<text>
  token-generator list
  token-generator revoke --token=<token> | --id=<id>

Examples:
  token-generator create --max-uses=10 --expires=720h --description="For new users"
  token-generator list
  token-generator revoke --token=abc123...
  token-generator revoke --id=5`)
}

func createToken(ctx context.Context, q *store.Queries) {
	var (
		maxUses     int
		expires     string
		description string
	)
	fs := flag.NewFlagSet("create", flag.ExitOnError)
	fs.IntVar(&maxUses, "max-uses", 0, "Maximum number of times this token can be used")
	fs.StringVar(&expires, "expires", "", "Expiration duration (e.g., 720h for 30 days)")
	fs.StringVar(&description, "description", "", "Description of the token (max 255 characters)")
	_ = fs.Parse(os.Args[2:])

	if maxUses <= 0 {
		log.Fatal("--max-uses must be greater than 0")
	}
	if expires == "" {
		log.Fatal("--expires is required (e.g., 720h)")
	}
	if len(description) > 255 {
		log.Fatal("--description must be 255 characters or less")
	}

	duration, err := time.ParseDuration(expires)
	if err != nil {
		log.Fatalf("Invalid duration format: %v", err)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatalf("Failed to generate random token: %v", err)
	}
	tokenValue := hex.EncodeToString(tokenBytes)

	tk, err := q.CreateInvitationToken(ctx, store.CreateInvitationTokenParams{
		Token:       tokenValue,
		Description: description,
		MaxUses:     int32(maxUses),
		ExpiresAt:   time.Now().Add(duration),
	})
	if err != nil {
		log.Fatalf("Failed to create token: %v", err)
	}

	fmt.Printf("Token created successfully!\n")
	fmt.Printf("  ID:          %d\n", tk.ID)
	fmt.Printf("  Token:       %s\n", tk.Token)
	fmt.Printf("  Description: %s\n", tk.Description)
	fmt.Printf("  Max uses:    %d\n", tk.MaxUses)
	fmt.Printf("  Expires at:  %s\n", tk.ExpiresAt.Format(time.RFC3339))
}

func listTokens(ctx context.Context, _ *db.DB, q *store.Queries) {
	tokens, err := q.ListInvitationTokens(ctx)
	if err != nil {
		log.Fatalf("Failed to query tokens: %v", err)
	}

	fmt.Println("Invitation Tokens:")
	fmt.Println("========================================================================================================================")
	fmt.Printf("%-5s %-12s %-22s %-6s %-9s %-20s %-20s\n", "ID", "Token", "Description", "Max", "Current", "Expires", "Created")
	fmt.Println("------------------------------------------------------------------------------------------------------------------------")

	for _, tk := range tokens {
		uses, err := q.CountUsesOfInvitationToken(ctx, tk.ID)
		if err != nil {
			log.Printf("Error counting uses for token %d: %v", tk.ID, err)
			uses = 0
		}

		displayToken := tk.Token
		if len(displayToken) > 10 {
			displayToken = displayToken[:10] + "…"
		}
		displayDesc := tk.Description
		if len(displayDesc) > 20 {
			displayDesc = displayDesc[:20] + "…"
		}

		status := "ACTIVE"
		switch {
		case uses >= int64(tk.MaxUses):
			status = "EXHAUSTED"
		case time.Now().After(tk.ExpiresAt):
			status = "EXPIRED"
		}

		fmt.Printf("%-5d %-12s %-22s %-6d %-9d %-20s %-20s [%s]\n",
			tk.ID,
			displayToken,
			displayDesc,
			tk.MaxUses,
			uses,
			tk.ExpiresAt.Format("2006-01-02 15:04"),
			tk.CreatedAt.Format("2006-01-02 15:04"),
			status)
	}
}

func revokeToken(ctx context.Context, q *store.Queries) {
	var (
		token   string
		tokenID int64
	)
	fs := flag.NewFlagSet("revoke", flag.ExitOnError)
	fs.StringVar(&token, "token", "", "Token to revoke")
	fs.Int64Var(&tokenID, "id", 0, "Token ID to revoke")
	_ = fs.Parse(os.Args[2:])

	if token == "" && tokenID == 0 {
		log.Fatal("Either --token or --id is required")
	}
	if token != "" && tokenID != 0 {
		log.Fatal("Only one of --token or --id can be specified")
	}

	if token != "" {
		n, err := q.RevokeInvitationTokenByValue(ctx, token)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Fatalf("Token not found: %s", token)
			}
			log.Fatalf("Failed to revoke token: %v", err)
		}
		if n == 0 {
			log.Fatalf("Token not found: %s", token)
		}
		fmt.Printf("Token revoked successfully: %s\n", token)
		return
	}

	n, err := q.RevokeInvitationTokenByID(ctx, tokenID)
	if err != nil {
		log.Fatalf("Failed to revoke token: %v", err)
	}
	if n == 0 {
		log.Fatalf("Token not found with ID: %d", tokenID)
	}
	fmt.Printf("Token revoked successfully: id=%d\n", tokenID)
}
