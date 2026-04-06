package auth

// Run with: DATABASE_URL=x JWT_SECRET=test go test ./internal/auth/ -v

import (
	"testing"

	"github.com/Alarion239/my239/backend/internal/config"
)

func TestGenerateAndValidateJWT(t *testing.T) {
	claims, err := ValidateJWT(mustGenerateJWT(t, 42, "alice"))
	if err != nil {
		t.Fatalf("expected valid token to pass validation: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("expected UserID 42, got %d", claims.UserID)
	}
	if claims.Username != "alice" {
		t.Errorf("expected username alice, got %s", claims.Username)
	}
}

func TestValidateJWT_InvalidToken(t *testing.T) {
	if _, err := ValidateJWT("this.is.garbage"); err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestValidateJWT_WrongSecret(t *testing.T) {
	token := mustGenerateJWT(t, 1, "bob")

	original := config.JWTSECRET
	config.JWTSECRET = "different-secret"
	defer func() { config.JWTSECRET = original }()

	if _, err := ValidateJWT(token); err == nil {
		t.Fatal("expected error when validating token with wrong secret")
	}
}

func mustGenerateJWT(t *testing.T, userID int64, username string) string {
	t.Helper()
	token, err := GenerateJWT(userID, username)
	if err != nil {
		t.Fatalf("failed to generate JWT: %v", err)
	}
	return token
}
