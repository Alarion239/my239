package config

import (
	"os"
	"path/filepath"
	"strings"
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

func TestLoad_GoogleServiceAccountCredentials(t *testing.T) {
	tests := []struct {
		name       string
		setup      func(t *testing.T)
		want       string
		wantErr    string
		secretText string
	}{
		{
			name: "disabled when neither source is set",
		},
		{
			name: "blank values are unset",
			setup: func(t *testing.T) {
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "  \n\t")
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", "  \n\t")
			},
		},
		{
			name: "inline JSON",
			setup: func(t *testing.T) {
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_JSON", `{"type":"service_account","private_key":"inline-private-key"}`)
			},
			want: `{"type":"service_account","private_key":"inline-private-key"}`,
		},
		{
			name: "mounted file",
			setup: func(t *testing.T) {
				filename := filepath.Join(t.TempDir(), "credentials.json")
				contents := "{\n  \"type\": \"service_account\",\n  \"private_key\": \"file-private-key\"\n}\n"
				if err := os.WriteFile(filename, []byte(contents), 0o600); err != nil {
					t.Fatalf("write credentials fixture: %v", err)
				}
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", filename)
			},
			want: "{\n  \"type\": \"service_account\",\n  \"private_key\": \"file-private-key\"\n}\n",
		},
		{
			name: "empty file",
			setup: func(t *testing.T) {
				filename := filepath.Join(t.TempDir(), "credentials.json")
				if err := os.WriteFile(filename, nil, 0o600); err != nil {
					t.Fatalf("write empty credentials fixture: %v", err)
				}
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", filename)
			},
			wantErr: "Google service account file is empty",
		},
		{
			name: "missing file",
			setup: func(t *testing.T) {
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", filepath.Join(t.TempDir(), "missing.json"))
			},
			wantErr: "read Google service account file",
		},
		{
			name: "unreadable file",
			setup: func(t *testing.T) {
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", t.TempDir())
			},
			wantErr: "read Google service account file",
		},
		{
			name: "both sources",
			setup: func(t *testing.T) {
				const secret = "representative-private-key"
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_JSON", `{"private_key":"`+secret+`"}`)
				t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", "/run/secrets/google.json")
			},
			wantErr:    "GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SERVICE_ACCOUNT_FILE cannot both be set",
			secretText: "representative-private-key",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			t.Setenv("JWT_SECRET", "test-secret")
			t.Setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
			t.Setenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")
			if test.setup != nil {
				test.setup(t)
			}

			cfg, err := Load()
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("Load() error = %v, want substring %q", err, test.wantErr)
				}
				if test.secretText != "" && strings.Contains(err.Error(), test.secretText) {
					t.Fatalf("Load() error leaked credential material: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if got := cfg.GoogleSheets.ServiceAccountJSON; got != test.want {
				t.Fatalf("GoogleSheets.ServiceAccountJSON = %q, want %q", got, test.want)
			}
		})
	}
}

func TestLoad_TelegramAlertsDisabledByDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("TELEGRAM_ALERTS_BOT_TOKEN", "")
	t.Setenv("TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD", "")
	t.Setenv("TELEGRAM_ALERTS_WEBHOOK_SECRET", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.TelegramAlerts.Enabled() {
		t.Fatal("Telegram alerts should be disabled without a bot token")
	}
	if cfg.TelegramAlerts.Environment != "development" {
		t.Fatalf("environment: got %q", cfg.TelegramAlerts.Environment)
	}
}

func TestLoad_TelegramAlertsRequiresCompleteSecureConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://example.com")
	t.Setenv("TELEGRAM_ALERTS_BOT_TOKEN", "bot-token")
	t.Setenv("TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD", "short")
	t.Setenv("TELEGRAM_ALERTS_WEBHOOK_SECRET", "bad secret")

	if _, err := Load(); err == nil {
		t.Fatal("expected Telegram configuration validation error")
	} else if strings.Contains(err.Error(), "bot-token") || strings.Contains(err.Error(), "short") {
		t.Fatalf("Telegram secret leaked in configuration error: %v", err)
	}
}

func TestLoad_TelegramAlertsValid(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://example.com/")
	t.Setenv("TELEGRAM_ALERTS_BOT_TOKEN", "bot-token")
	t.Setenv("TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD", "a-very-long-secret-password")
	t.Setenv("TELEGRAM_ALERTS_WEBHOOK_SECRET", "hook_secret-01")
	t.Setenv("APP_ENVIRONMENT", "production")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.TelegramAlerts.Enabled() {
		t.Fatal("Telegram alerts should be enabled")
	}
	if cfg.TelegramAlerts.WebhookURL != "https://example.com/api/v1/telegram-alerts/webhook" {
		t.Fatalf("webhook URL: got %q", cfg.TelegramAlerts.WebhookURL)
	}
	if cfg.TelegramAlerts.Environment != "production" {
		t.Fatalf("environment: got %q", cfg.TelegramAlerts.Environment)
	}
}
