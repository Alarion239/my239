package config

import (
	"fmt"
	"os"
	"strconv"
)

var (
	// Database
	DatabaseURL string

	// JWT
	JWTSECRET          string
	JWTExpirationHours int

	// Server
	Port        string
	FrontendURL string
)

func init() {
	// Required variables - panic if missing
	DatabaseURL = os.Getenv("DATABASE_URL")
	if DatabaseURL == "" {
		panic("DATABASE_URL environment variable is required")
	}

	JWTSECRET = os.Getenv("JWT_SECRET")
	if JWTSECRET == "" {
		panic("JWT_SECRET environment variable is required")
	}

	// Optional variables with defaults
	portStr := os.Getenv("PORT")
	if portStr == "" {
		portStr = "8080"
	}
	Port = portStr

	FrontendURL = os.Getenv("FRONTEND_URL")
	if FrontendURL == "" {
		FrontendURL = "http://localhost:3000"
	}

	expirationStr := os.Getenv("JWT_EXPIRATION_HOURS")
	if expirationStr == "" {
		expirationStr = "24"
	}
	var err error
	JWTExpirationHours, err = strconv.Atoi(expirationStr)
	if err != nil {
		panic(fmt.Sprintf("Invalid JWT_EXPIRATION_HOURS: %v (must be an integer)", err))
	}
}
