package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL        string
	JWTSecret          string
	JWTExpirationHours int
	Port               string
	FrontendURL        string
}

func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET environment variable is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3000"
	}

	expirationStr := os.Getenv("JWT_EXPIRATION_HOURS")
	if expirationStr == "" {
		expirationStr = "24"
	}
	expirationHours, err := strconv.Atoi(expirationStr)
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_EXPIRATION_HOURS: %v (must be an integer)", err)
	}

	return &Config{
		DatabaseURL:        databaseURL,
		JWTSecret:          jwtSecret,
		JWTExpirationHours: expirationHours,
		Port:               port,
		FrontendURL:        frontendURL,
	}, nil
}
