package auth

// Run with: go test ./internal/auth/ -v

import (
	"testing"
)

func TestGenerateAndValidateJWT(t *testing.T) {
	svc := NewJWTService("test-secret", 24)
	claims, err := svc.Validate(mustGenerateJWT(t, svc, 42, "alice"))
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
	svc := NewJWTService("test-secret", 24)
	if _, err := svc.Validate("this.is.garbage"); err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestValidateJWT_WrongSecret(t *testing.T) {
	svc1 := NewJWTService("secret-one", 24)
	svc2 := NewJWTService("secret-two", 24)
	token := mustGenerateJWT(t, svc1, 1, "bob")
	if _, err := svc2.Validate(token); err == nil {
		t.Fatal("expected error when validating token with wrong secret")
	}
}

func mustGenerateJWT(t *testing.T, svc *JWTService, userID int64, username string) string {
	t.Helper()
	token, err := svc.Generate(userID, username)
	if err != nil {
		t.Fatalf("failed to generate JWT: %v", err)
	}
	return token
}
