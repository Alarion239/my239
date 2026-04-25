package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL string
	RedisURL    string // empty means: use the in-memory rate limiter
	Port        string
	FrontendURL string

	JWT JWTConfig
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

// Load reads configuration from environment variables. Returns an error
// describing the first missing/invalid value rather than partially
// populating Config — fail fast at startup.
func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET environment variable is required")
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
		return nil, fmt.Errorf("JWT_ACCESS_TTL_MINUTES must be positive")
	}

	refreshDays, err := envInt("JWT_REFRESH_TTL_DAYS", 30)
	if err != nil {
		return nil, err
	}
	if refreshDays <= 0 {
		return nil, fmt.Errorf("JWT_REFRESH_TTL_DAYS must be positive")
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
	}, nil
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
