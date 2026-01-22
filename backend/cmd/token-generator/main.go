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

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/models/authorize"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func main() {
	// Initialize database
	db, err := db.NewDB(context.Background(), config.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Parse command
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	command := os.Args[1]
	switch command {
	case "create":
		createToken(db)
	case "list":
		listTokens(db)
	case "revoke":
		revokeToken(db)
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Token Generator CLI")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  token-generator create --max-uses=<number> --expires=<hours>h --description=<text>")
	fmt.Println("  token-generator list")
	fmt.Println("  token-generator revoke --token=<token> | --id=<id>")
	fmt.Println("")
	fmt.Println("Examples:")
	fmt.Println("  token-generator create --max-uses=10 --expires=720h --description=\"For new users\"")
	fmt.Println("  token-generator create --max-uses=5 --expires=168h --description=\"Beta testers\"")
	fmt.Println("  token-generator list")
	fmt.Println("  token-generator revoke --token=abc123...")
	fmt.Println("  token-generator revoke --id=5")
}

func createToken(db *db.DB) {
	var maxUses int
	var expires string
	var description string

	fs := flag.NewFlagSet("create", flag.ExitOnError)
	fs.IntVar(&maxUses, "max-uses", 0, "Maximum number of times this token can be used")
	fs.StringVar(&expires, "expires", "", "Expiration time (e.g., 720h for 30 days)")
	fs.StringVar(&description, "description", "", "Description of the token (max 255 characters)")

	fs.Parse(os.Args[2:])

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

	createdAt := time.Now()
	expiresAt := createdAt.Add(duration)

	// Generate cryptographically secure token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatalf("Failed to generate random token: %v", err)
	}
	token := hex.EncodeToString(tokenBytes)

	ctx := context.Background()
	Token := authorize.InvitationToken{ID: -1, Token: token, Description: description, MaxUses: maxUses, ExpiresAt: expiresAt, CreatedAt: createdAt}
	Token.ID, err = authorize.NewInvitationTokenRepo(db).Create(ctx, &Token)
	if err != nil {
		log.Fatalf("Failed to create token: %v", err)
	}

	fmt.Printf("Token created successfully!\n")
	fmt.Printf("ID: %d\n", Token.ID)
	fmt.Printf("Token: %s\n", Token.Token)
	fmt.Printf("Description: %s\n", Token.Description)
	fmt.Printf("Max Uses: %d\n", Token.MaxUses)
	fmt.Printf("Expires At: %s\n", expiresAt.Format(time.RFC3339))
}

func listTokens(database *db.DB) {
	// Get database connection
	repo := authorize.NewInvitationTokenRepo(database)

	ctx := context.Background()
	tokens, err := repo.ListAll(ctx)
	if err != nil {
		log.Fatalf("Failed to query tokens: %v", err)
	}

	fmt.Println("Invitation Tokens:")
	fmt.Println("========================================================================================================================")
	fmt.Printf("%-5s %-10s %-20s %-8s %-10s %-20s %-20s\n", "ID", "Token", "Description", "Max", "Current", "Expires", "Created")
	fmt.Println("------------------------------------------------------------------------------------------------------------------------")

	for _, token := range tokens {
		// Get current uses from the users table
		currentUses, err := repo.CountUsesOfToken(ctx, token.ID)
		if err != nil {
			log.Printf("Error counting uses for token %d: %v", token.ID, err)
			currentUses = 0
		}

		// Truncate token for display
		displayToken := token.Token
		if len(displayToken) > 10 {
			displayToken = displayToken[:10] + "..."
		}

		// Truncate description for display
		displayDesc := token.Description
		if len(displayDesc) > 20 {
			displayDesc = displayDesc[:20] + "..."
		}

		status := "ACTIVE"
		if currentUses >= token.MaxUses {
			status = "EXHAUSTED"
		} else if time.Now().After(token.ExpiresAt) {
			status = "EXPIRED"
		}

		fmt.Printf("%-5d %-10s %-20s %-8d %-10d %-20s %-20s [%s]\n",
			token.ID,
			displayToken,
			displayDesc,
			token.MaxUses,
			currentUses,
			token.ExpiresAt.Format("2006-01-02 15:04"),
			token.CreatedAt.Format("2006-01-02 15:04"),
			status)
	}
}

func revokeToken(database *db.DB) {
	var token string
	var tokenID int64

	fs := flag.NewFlagSet("revoke", flag.ExitOnError)
	fs.StringVar(&token, "token", "", "Token to revoke")
	fs.Int64Var(&tokenID, "id", 0, "Token ID to revoke")

	fs.Parse(os.Args[2:])

	if token == "" && tokenID == 0 {
		log.Fatal("Either --token or --id is required")
	}

	if token != "" && tokenID != 0 {
		log.Fatal("Only one of --token or --id can be specified")
	}

	repo := authorize.NewInvitationTokenRepo(database)
	ctx := context.Background()

	var err error
	if token != "" {
		err = repo.Revoke(ctx, token)
		if err != nil {
			if errors.Is(err, authorize.ErrTokenNotFound) {
				log.Fatalf("Token not found: %s", token)
			}
			log.Fatalf("Failed to revoke token: %v", err)
		}
		fmt.Printf("Token revoked successfully: %s\n", token)
	} else {
		err = repo.RevokeByID(ctx, tokenID)
		if err != nil {
			if errors.Is(err, authorize.ErrTokenNotFound) {
				log.Fatalf("Token not found with ID: %d", tokenID)
			}
			log.Fatalf("Failed to revoke token: %v", err)
		}
		fmt.Printf("Token revoked successfully: %d\n", tokenID)
	}
}
