// Package main is the invitation-token generator CLI. Admin-only — talks
// directly to the database to create / list / revoke invitation tokens that
// are required for new-user registration.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
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
  token-generator create --max-uses=<n> --expires=<duration> --description=<text> [preset flags]
  token-generator list
  token-generator revoke --token=<token> | --id=<id>

Preset flags (optional; describe who the registrant becomes — enforced at
registration). Either pass raw JSON via --preset, OR use the convenience flags,
not both:
  --preset='<json>'            Raw preset JSON, e.g. '{"grants_admin":true}'
  --grant-admin                Grant admin on registration
  --student-group-id=<id>      Enroll as math-center student in this group
  --teacher-center-id=<id>     Enroll as math-center teacher of this center
  --head-teacher               With --teacher-center-id, enroll as head teacher

Examples:
  token-generator create --max-uses=10 --expires=720h --description="For new users"
  token-generator create --max-uses=1 --expires=72h --description="New admin" --grant-admin
  token-generator create --max-uses=1 --expires=72h --description="Student" --student-group-id=3
  token-generator create --max-uses=1 --expires=72h --description="Head teacher" --teacher-center-id=2 --head-teacher
  token-generator create --max-uses=1 --expires=72h --description="raw" --preset='{"grants_admin":true}'
  token-generator list
  token-generator revoke --token=abc123...
  token-generator revoke --id=5`)
}

func createToken(ctx context.Context, q *store.Queries) {
	var (
		maxUses        int
		expires        string
		description    string
		presetJSON     string
		grantAdmin     bool
		studentGroupID int64
		teacherCenter  int64
		headTeacher    bool
	)
	fs := flag.NewFlagSet("create", flag.ExitOnError)
	fs.IntVar(&maxUses, "max-uses", 0, "Maximum number of times this token can be used")
	fs.StringVar(&expires, "expires", "", "Expiration duration (e.g., 720h for 30 days)")
	fs.StringVar(&description, "description", "", "Description of the token (max 255 characters)")
	fs.StringVar(&presetJSON, "preset", "", "Raw preset JSON (mutually exclusive with the convenience flags)")
	fs.BoolVar(&grantAdmin, "grant-admin", false, "Grant admin on registration")
	fs.Int64Var(&studentGroupID, "student-group-id", 0, "Enroll registrant as a math-center student in this group")
	fs.Int64Var(&teacherCenter, "teacher-center-id", 0, "Enroll registrant as a math-center teacher of this center")
	fs.BoolVar(&headTeacher, "head-teacher", false, "With --teacher-center-id, enroll as head teacher")
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

	preset := buildPreset(presetJSON, grantAdmin, studentGroupID, teacherCenter, headTeacher)

	// Validate against the DB before minting, so the CLI cannot create a token
	// referencing a non-existent group/center or an internally contradictory
	// preset (e.g. student + teacher of the same center).
	if err := tokenpreset.Validate(ctx, q, preset); err != nil {
		log.Fatalf("Invalid preset: %v", err)
	}
	storedPreset, err := tokenpreset.Marshal(preset)
	if err != nil {
		log.Fatalf("Failed to encode preset: %v", err)
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
		Preset:      storedPreset,
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
	fmt.Printf("  Preset:      %s\n", tk.Preset)
}

// buildPreset turns the CLI flags into a Preset. --preset (raw JSON) and the
// convenience flags are mutually exclusive: passing both is a usage error.
func buildPreset(presetJSON string, grantAdmin bool, studentGroupID, teacherCenter int64, headTeacher bool) tokenpreset.Preset {
	convenienceUsed := grantAdmin || studentGroupID != 0 || teacherCenter != 0 || headTeacher

	if presetJSON != "" {
		if convenienceUsed {
			log.Fatal("--preset cannot be combined with --grant-admin/--student-group-id/--teacher-center-id/--head-teacher")
		}
		preset, err := tokenpreset.Parse(json.RawMessage(presetJSON))
		if err != nil {
			log.Fatalf("Invalid --preset JSON: %v", err)
		}
		return preset
	}

	if headTeacher && teacherCenter == 0 {
		log.Fatal("--head-teacher requires --teacher-center-id")
	}

	preset := tokenpreset.Preset{GrantsAdmin: grantAdmin}
	if studentGroupID != 0 {
		preset.MathCenterStudent = &tokenpreset.MathCenterStudent{GroupID: studentGroupID}
	}
	if teacherCenter != 0 {
		preset.MathCenterTeacher = &tokenpreset.MathCenterTeacher{
			CenterID:      teacherCenter,
			IsHeadTeacher: headTeacher,
		}
	}
	return preset
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
