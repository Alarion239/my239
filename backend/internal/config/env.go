// Package config loads and validates runtime configuration from environment
// variables, and defines the request-context keys shared across middleware
// and handlers.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL string
	RedisURL    string // empty means: use the in-memory rate limiter
	Port        string
	FrontendURL string

	JWT            JWTConfig
	S3             S3Config
	GoogleSheets   GoogleSheetsConfig
	TelegramAlerts TelegramAlertsConfig
}

// GoogleSheetsConfig is optional so local development and deployments that do
// not use the integration continue to start. The JSON stays only in process
// configuration; it is never persisted or returned by an API.
type GoogleSheetsConfig struct {
	ServiceAccountJSON string
}

// TelegramAlertsConfig contains the optional Telegram error-alert integration.
// The bot token and enrollment password are kept in process memory only; they
// are never persisted or returned by an API.
type TelegramAlertsConfig struct {
	BotToken          string
	SubscribePassword string
	WebhookSecret     string
	WebhookURL        string
	Environment       string
}

// Enabled reports whether Telegram alerts have been configured.
func (c TelegramAlertsConfig) Enabled() bool {
	return c.BotToken != ""
}

// JWTConfig groups all JWT-related settings so handler code can pass it
// around as a single value.
type JWTConfig struct {
	Secret     string
	Issuer     string
	Audience   string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

// S3Config carries the object storage settings. Bucket empty means: fall back
// to the in-memory store (handy for local dev/tests). Endpoint defaults to
// Yandex Object Storage so a Russian deploy only needs to set bucket + creds.
type S3Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	UsePathStyle    bool
	DownloadTTL     time.Duration
	// UploadTTL is the lifetime of presigned PUT URLs minted for client-direct
	// uploads (homework photos, series PDFs). Kept short — the client should
	// hit the URL immediately after receiving it.
	UploadTTL time.Duration
}

// Load reads configuration from environment variables. Returns an error
// describing the first missing/invalid value rather than partially
// populating Config — fail fast at startup.
func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, errors.New("DATABASE_URL environment variable is required")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return nil, errors.New("JWT_SECRET environment variable is required")
	}

	port := envOrDefault("PORT", "8080")
	frontendURL := envOrDefault("FRONTEND_URL", "http://localhost:3000")
	redisURL := os.Getenv("REDIS_URL")

	jwtIssuer := envOrDefault("JWT_ISSUER", "my239")
	jwtAudience := envOrDefault("JWT_AUDIENCE", "api")

	accessMin, err := envInt("JWT_ACCESS_TTL_MINUTES", 15)
	if err != nil {
		return nil, err
	}
	if accessMin <= 0 {
		return nil, errors.New("JWT_ACCESS_TTL_MINUTES must be positive")
	}

	refreshDays, err := envInt("JWT_REFRESH_TTL_DAYS", 30)
	if err != nil {
		return nil, err
	}
	if refreshDays <= 0 {
		return nil, errors.New("JWT_REFRESH_TTL_DAYS must be positive")
	}

	// Backwards-compat: old deploys set JWT_EXPIRATION_HOURS for the (single)
	// access-token lifetime. Honor it if present and JWT_ACCESS_TTL_MINUTES
	// was not explicitly set.
	if os.Getenv("JWT_ACCESS_TTL_MINUTES") == "" {
		if hoursStr := os.Getenv("JWT_EXPIRATION_HOURS"); hoursStr != "" {
			h, err := strconv.Atoi(hoursStr)
			if err != nil {
				return nil, fmt.Errorf("invalid JWT_EXPIRATION_HOURS: %w", err)
			}
			accessMin = h * 60
		}
	}

	s3Endpoint := envOrDefault("S3_ENDPOINT", "https://storage.yandexcloud.net")
	s3Region := envOrDefault("S3_REGION", "ru-central1")
	s3Bucket := os.Getenv("S3_BUCKET")
	s3KeyID := os.Getenv("S3_ACCESS_KEY_ID")
	s3Secret := os.Getenv("S3_SECRET_ACCESS_KEY")
	s3PathStyle := os.Getenv("S3_USE_PATH_STYLE") != "false" // default true; safest for arbitrary bucket names
	googleServiceAccountJSON, err := loadGoogleServiceAccountJSON()
	if err != nil {
		return nil, err
	}
	s3TTLMin, err := envInt("S3_DOWNLOAD_TTL_MINUTES", 15)
	if err != nil {
		return nil, err
	}
	if s3TTLMin <= 0 {
		return nil, errors.New("S3_DOWNLOAD_TTL_MINUTES must be positive")
	}
	s3UploadTTLMin, err := envInt("S3_UPLOAD_TTL_MINUTES", 5)
	if err != nil {
		return nil, err
	}
	if s3UploadTTLMin <= 0 {
		return nil, errors.New("S3_UPLOAD_TTL_MINUTES must be positive")
	}
	// If a bucket is configured, the credential pair must come along with it.
	// Empty bucket is a deliberate "use memory store" sentinel.
	if s3Bucket != "" && (s3KeyID == "" || s3Secret == "") {
		return nil, errors.New("S3_BUCKET set but S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY missing")
	}

	telegramAlerts, err := loadTelegramAlerts(frontendURL)
	if err != nil {
		return nil, err
	}

	return &Config{
		DatabaseURL: databaseURL,
		RedisURL:    redisURL,
		Port:        port,
		FrontendURL: frontendURL,
		JWT: JWTConfig{
			Secret:     jwtSecret,
			Issuer:     jwtIssuer,
			Audience:   jwtAudience,
			AccessTTL:  time.Duration(accessMin) * time.Minute,
			RefreshTTL: time.Duration(refreshDays) * 24 * time.Hour,
		},
		S3: S3Config{
			Endpoint:        s3Endpoint,
			Region:          s3Region,
			Bucket:          s3Bucket,
			AccessKeyID:     s3KeyID,
			SecretAccessKey: s3Secret,
			UsePathStyle:    s3PathStyle,
			DownloadTTL:     time.Duration(s3TTLMin) * time.Minute,
			UploadTTL:       time.Duration(s3UploadTTLMin) * time.Minute,
		},
		GoogleSheets:   GoogleSheetsConfig{ServiceAccountJSON: googleServiceAccountJSON},
		TelegramAlerts: telegramAlerts,
	}, nil
}

func loadGoogleServiceAccountJSON() (string, error) {
	inline := strings.TrimSpace(os.Getenv("GOOGLE_SERVICE_ACCOUNT_JSON"))
	filename := strings.TrimSpace(os.Getenv("GOOGLE_SERVICE_ACCOUNT_FILE"))
	if inline != "" && filename != "" {
		return "", errors.New("GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SERVICE_ACCOUNT_FILE cannot both be set")
	}
	if inline != "" {
		return inline, nil
	}
	if filename == "" {
		return "", nil
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		return "", fmt.Errorf("read Google service account file %q: %w", filename, err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return "", errors.New("Google service account file is empty")
	}
	return string(data), nil
}

func loadTelegramAlerts(frontendURL string) (TelegramAlertsConfig, error) {
	cfg := TelegramAlertsConfig{
		BotToken:          os.Getenv("TELEGRAM_ALERTS_BOT_TOKEN"),
		SubscribePassword: os.Getenv("TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD"),
		WebhookSecret:     os.Getenv("TELEGRAM_ALERTS_WEBHOOK_SECRET"),
		Environment:       envOrDefault("APP_ENVIRONMENT", "development"),
	}
	if cfg.BotToken == "" {
		return cfg, nil
	}
	if cfg.SubscribePassword == "" || cfg.WebhookSecret == "" {
		return TelegramAlertsConfig{}, errors.New("TELEGRAM_ALERTS_BOT_TOKEN requires TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD and TELEGRAM_ALERTS_WEBHOOK_SECRET")
	}
	if len(cfg.SubscribePassword) < 16 {
		return TelegramAlertsConfig{}, errors.New("TELEGRAM_ALERTS_SUBSCRIBE_PASSWORD must be at least 16 characters")
	}
	if len(cfg.WebhookSecret) > 256 || !isTelegramWebhookSecret(cfg.WebhookSecret) {
		return TelegramAlertsConfig{}, errors.New("TELEGRAM_ALERTS_WEBHOOK_SECRET must contain only letters, digits, underscores, or hyphens")
	}
	u, err := url.Parse(frontendURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return TelegramAlertsConfig{}, errors.New("TELEGRAM alerts require an HTTPS FRONTEND_URL")
	}
	cfg.WebhookURL = strings.TrimRight(frontendURL, "/") + "/api/v1/telegram-alerts/webhook"
	return cfg, nil
}

func isTelegramWebhookSecret(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return n, nil
}
