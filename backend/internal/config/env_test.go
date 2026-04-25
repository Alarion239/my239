package config

import (
	"testing"
	"time"
)

func TestLoad_Success_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("PORT", "")
	t.Setenv("FRONTEND_URL", "")
	t.Setenv("JWT_ACCESS_TTL_MINUTES", "")
	t.Setenv("JWT_REFRESH_TTL_DAYS", "")
	t.Setenv("JWT_EXPIRATION_HOURS", "")
	t.Setenv("REDIS_URL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("expected default port 8080, got %q", cfg.Port)
	}
	if cfg.FrontendURL != "http://localhost:3000" {
		t.Errorf("expected default frontend URL, got %q", cfg.FrontendURL)
	}
	if cfg.JWT.AccessTTL != 15*time.Minute {
		t.Errorf("expected default access TTL 15m, got %v", cfg.JWT.AccessTTL)
	}
	if cfg.JWT.RefreshTTL != 30*24*time.Hour {
		t.Errorf("expected default refresh TTL 30d, got %v", cfg.JWT.RefreshTTL)
	}
	if cfg.JWT.Issuer != "my239" {
		t.Errorf("expected default issuer my239, got %q", cfg.JWT.Issuer)
	}
	if cfg.JWT.Audience != "api" {
		t.Errorf("expected default audience api, got %q", cfg.JWT.Audience)
	}
	if cfg.RedisURL != "" {
		t.Errorf("expected empty REDIS_URL by default, got %q", cfg.RedisURL)
	}
}

func TestLoad_LegacyJWTExpirationHoursAccepted(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("JWT_ACCESS_TTL_MINUTES", "")
	t.Setenv("JWT_EXPIRATION_HOURS", "2")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.JWT.AccessTTL != 2*time.Hour {
		t.Errorf("legacy hours mapping: got %v, want 2h", cfg.JWT.AccessTTL)
	}
}

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "x")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is missing")
	}
}

func TestLoad_MissingJWTSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when JWT_SECRET is missing")
	}
}

func TestLoad_InvalidExpiration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("JWT_ACCESS_TTL_MINUTES", "not-a-number")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when JWT_ACCESS_TTL_MINUTES is not an integer")
	}
}

func TestLoad_NonPositiveAccessTTL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("JWT_ACCESS_TTL_MINUTES", "0")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when JWT_ACCESS_TTL_MINUTES is zero")
	}
}

func TestLoad_CustomValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("PORT", "9090")
	t.Setenv("FRONTEND_URL", "https://example.com")
	t.Setenv("JWT_ACCESS_TTL_MINUTES", "5")
	t.Setenv("JWT_REFRESH_TTL_DAYS", "7")
	t.Setenv("JWT_ISSUER", "myissuer")
	t.Setenv("JWT_AUDIENCE", "myaud")
	t.Setenv("REDIS_URL", "redis://r:6379/0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("port: got %q", cfg.Port)
	}
	if cfg.FrontendURL != "https://example.com" {
		t.Errorf("frontendURL: got %q", cfg.FrontendURL)
	}
	if cfg.JWT.AccessTTL != 5*time.Minute {
		t.Errorf("AccessTTL: got %v", cfg.JWT.AccessTTL)
	}
	if cfg.JWT.RefreshTTL != 7*24*time.Hour {
		t.Errorf("RefreshTTL: got %v", cfg.JWT.RefreshTTL)
	}
	if cfg.JWT.Issuer != "myissuer" || cfg.JWT.Audience != "myaud" {
		t.Errorf("issuer/audience: got %q / %q", cfg.JWT.Issuer, cfg.JWT.Audience)
	}
	if cfg.RedisURL != "redis://r:6379/0" {
		t.Errorf("RedisURL: got %q", cfg.RedisURL)
	}
	if cfg.DatabaseURL != "postgres://localhost/test" {
		t.Errorf("dbURL: got %q", cfg.DatabaseURL)
	}
	if cfg.JWT.Secret != "secret" {
		t.Errorf("jwtSecret: got %q", cfg.JWT.Secret)
	}
}
