package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newTestSvc(t *testing.T) *AccessTokenService {
	t.Helper()
	svc, err := NewAccessTokenService(AccessTokenConfig{
		Secret:     "test-secret",
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		Expiration: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewAccessTokenService: %v", err)
	}
	return svc
}

func TestNewAccessTokenService_RejectsBadConfig(t *testing.T) {
	cases := []struct {
		name string
		cfg  AccessTokenConfig
	}{
		{"empty secret", AccessTokenConfig{Issuer: "i", Audience: "a", Expiration: time.Hour}},
		{"empty issuer", AccessTokenConfig{Secret: "s", Audience: "a", Expiration: time.Hour}},
		{"empty audience", AccessTokenConfig{Secret: "s", Issuer: "i", Expiration: time.Hour}},
		{"zero expiration", AccessTokenConfig{Secret: "s", Issuer: "i", Audience: "a"}},
		{"negative expiration", AccessTokenConfig{Secret: "s", Issuer: "i", Audience: "a", Expiration: -time.Second}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewAccessTokenService(tc.cfg); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestGenerateAndValidate_Success(t *testing.T) {
	svc := newTestSvc(t)
	tok, err := svc.Generate(42, "alice")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	claims, err := svc.Validate(tok)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("UserID: got %d, want 42", claims.UserID)
	}
	if claims.Username != "alice" {
		t.Errorf("Username: got %q", claims.Username)
	}
	if claims.Issuer != "test-issuer" {
		t.Errorf("iss: got %q", claims.Issuer)
	}
	if len(claims.Audience) == 0 || claims.Audience[0] != "test-audience" {
		t.Errorf("aud: got %v", claims.Audience)
	}
	if claims.Subject != "42" {
		t.Errorf("sub: got %q, want 42", claims.Subject)
	}
	if claims.ID == "" {
		t.Error("expected non-empty jti")
	}
	if claims.NotBefore == nil {
		t.Error("nbf should be set")
	}
	if claims.IssuedAt == nil {
		t.Error("iat should be set")
	}
}

func TestValidate_InvalidToken(t *testing.T) {
	svc := newTestSvc(t)
	if _, err := svc.Validate("garbage.token"); err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestValidate_WrongSecret(t *testing.T) {
	a := newTestSvc(t)
	b, _ := NewAccessTokenService(AccessTokenConfig{
		Secret: "different", Issuer: "test-issuer", Audience: "test-audience", Expiration: time.Hour,
	})
	tok, _ := a.Generate(1, "x")
	if _, err := b.Validate(tok); err == nil {
		t.Fatal("expected error when validating with different secret")
	}
}

func TestValidate_WrongIssuer(t *testing.T) {
	a := newTestSvc(t)
	b, _ := NewAccessTokenService(AccessTokenConfig{
		Secret: "test-secret", Issuer: "other-issuer", Audience: "test-audience", Expiration: time.Hour,
	})
	tok, _ := a.Generate(1, "x")
	if _, err := b.Validate(tok); err == nil {
		t.Fatal("expected error for wrong issuer")
	}
}

func TestValidate_WrongAudience(t *testing.T) {
	a := newTestSvc(t)
	b, _ := NewAccessTokenService(AccessTokenConfig{
		Secret: "test-secret", Issuer: "test-issuer", Audience: "other-audience", Expiration: time.Hour,
	})
	tok, _ := a.Generate(1, "x")
	if _, err := b.Validate(tok); err == nil {
		t.Fatal("expected error for wrong audience")
	}
}

func TestValidate_RejectsNoneAlg(t *testing.T) {
	svc := newTestSvc(t)
	// Hand-craft a token with alg=none. The library MUST refuse it because
	// we restricted the parser to HS256.
	claims := AccessClaims{
		UserID: 1, Username: "x",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "test-issuer",
			Audience:  jwt.ClaimStrings{"test-audience"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(signed); err == nil {
		t.Fatal("expected error: 'none' alg must be rejected")
	}
}

func TestValidate_Expired(t *testing.T) {
	svc, _ := NewAccessTokenService(AccessTokenConfig{
		Secret:     "test-secret",
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		Expiration: time.Millisecond,
	})
	tok, err := svc.Generate(1, "x")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	_, err = svc.Validate(tok)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestExpirationSeconds(t *testing.T) {
	svc, _ := NewAccessTokenService(AccessTokenConfig{
		Secret: "s", Issuer: "i", Audience: "a", Expiration: 90 * time.Second,
	})
	if got := svc.ExpirationSeconds(); got != 90 {
		t.Errorf("ExpirationSeconds: got %d, want 90", got)
	}
}

// Token format check: a JWS produced by HS256 must have three dot-separated
// base64-url segments. Sanity check that we're really emitting JWTs.
func TestGenerateProducesJWS(t *testing.T) {
	svc := newTestSvc(t)
	tok, err := svc.Generate(1, "x")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Errorf("expected 3 segments, got %d", len(parts))
	}
}
