package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AccessClaims is the payload of an access JWT.
//
// Standard claims are populated:
//   - iss: who issued the token (this service)
//   - aud: intended audience (typically "api")
//   - sub: stringified user_id
//   - iat: issued-at
//   - nbf: not-before (== iat)
//   - exp: expiration
//   - jti: random unique ID, useful for blacklisting if we ever add that
//
// Custom claims piggy-back on RegisteredClaims so jwt.Validator handles all
// the time/issuer/audience checks for us.
type AccessClaims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
	jwt.RegisteredClaims
}

// AccessTokenService issues and validates short-lived JWT access tokens.
type AccessTokenService struct {
	secret     []byte
	issuer     string
	audience   string
	expiration time.Duration
	now        func() time.Time // injectable for tests
}

// AccessTokenConfig groups the inputs to NewAccessTokenService so callers
// don't have to remember positional arg order.
type AccessTokenConfig struct {
	Secret     string
	Issuer     string
	Audience   string
	Expiration time.Duration
}

// NewAccessTokenService validates the config and returns the service. It
// returns an error rather than panicking so the caller can surface a helpful
// startup error.
func NewAccessTokenService(cfg AccessTokenConfig) (*AccessTokenService, error) {
	if cfg.Secret == "" {
		return nil, errors.New("access token secret must not be empty")
	}
	if cfg.Issuer == "" {
		return nil, errors.New("access token issuer must not be empty")
	}
	if cfg.Audience == "" {
		return nil, errors.New("access token audience must not be empty")
	}
	if cfg.Expiration <= 0 {
		return nil, errors.New("access token expiration must be positive")
	}
	return &AccessTokenService{
		secret:     []byte(cfg.Secret),
		issuer:     cfg.Issuer,
		audience:   cfg.Audience,
		expiration: cfg.Expiration,
		now:        time.Now,
	}, nil
}

// Generate signs a JWT for the given user.
func (s *AccessTokenService) Generate(userID int64, username string, isAdmin bool) (string, error) {
	now := s.now()
	jti, err := randomHex(16)
	if err != nil {
		return "", fmt.Errorf("generate jti: %w", err)
	}

	claims := AccessClaims{
		UserID:   userID,
		Username: username,
		IsAdmin:  isAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   fmt.Sprintf("%d", userID),
			Audience:  jwt.ClaimStrings{s.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.expiration)),
			ID:        jti,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

// Validate parses and verifies the token. The library checks signature, exp,
// nbf, iat, iss, and aud automatically when we configure the validator.
func (s *AccessTokenService) Validate(tokenString string) (*AccessClaims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(s.issuer),
		jwt.WithAudience(s.audience),
		jwt.WithExpirationRequired(), // reject tokens that omit exp
	)

	token, err := parser.ParseWithClaims(tokenString, &AccessClaims{}, func(token *jwt.Token) (any, error) {
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*AccessClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// ExpirationSeconds returns the access-token lifetime as whole seconds, for
// the OAuth2-style `expires_in` field of token responses.
func (s *AccessTokenService) ExpirationSeconds() int {
	return int(s.expiration / time.Second)
}

// JWTService and Claims are short, idiomatic aliases used by middleware and
// tests. They name the same things as AccessTokenService / AccessClaims; the
// shorter names make the call sites — particularly the middleware constructor
// signature — read better.
type JWTService = AccessTokenService
type Claims = AccessClaims

// MustNewJWTService is a convenience constructor used by tests and bootstrap
// scripts. It applies the project-default issuer/audience and expresses
// expiration in whole hours; the production server path uses
// NewAccessTokenService directly so it can pass through the configured TTL
// from env. It panics on invalid config — the Must prefix signals that, and
// keeps callers from silently receiving a nil service.
func MustNewJWTService(secret string, expirationHours int) *JWTService {
	svc, err := NewAccessTokenService(AccessTokenConfig{
		Secret:     secret,
		Issuer:     "my239",
		Audience:   "api",
		Expiration: time.Duration(expirationHours) * time.Hour,
	})
	if err != nil {
		panic(fmt.Sprintf("auth: MustNewJWTService: %v", err))
	}
	return svc
}

// randomHex returns 2*n hex characters of cryptographically random data.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
