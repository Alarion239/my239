package auth

import (
	"context"
	"errors"
	"fmt"
)

// TokenService is a small facade that owns both halves of the auth
// token system: short-lived JWT access tokens and long-lived rotating
// refresh tokens. Handlers depend on this single type rather than juggling
// AccessTokenService and RefreshTokenService separately.
type TokenService struct {
	access  *AccessTokenService
	refresh *RefreshTokenService
}

// TokenPair is what handlers return to a client after a successful login,
// register, or refresh.
type TokenPair struct {
	AccessToken            string
	RefreshToken           string
	AccessExpiresInSeconds int
}

// TokenServiceConfig wires the underlying services. Pass either Access /
// Refresh directly (e.g. in tests with custom clocks), or pass AccessConfig /
// RefreshConfig and let the constructor build them.
type TokenServiceConfig struct {
	Access  *AccessTokenService
	Refresh *RefreshTokenService

	// AccessConfig and RefreshConfig are used only when Access/Refresh are nil.
	AccessConfig  *AccessTokenConfig
	RefreshConfig *RefreshTokenConfig
}

func NewTokenService(cfg TokenServiceConfig) (*TokenService, error) {
	access := cfg.Access
	if access == nil {
		if cfg.AccessConfig == nil {
			return nil, errors.New("token service: access service or config required")
		}
		a, err := NewAccessTokenService(*cfg.AccessConfig)
		if err != nil {
			return nil, err
		}
		access = a
	}
	refresh := cfg.Refresh
	if refresh == nil {
		if cfg.RefreshConfig == nil {
			return nil, errors.New("token service: refresh service or config required")
		}
		r, err := NewRefreshTokenService(*cfg.RefreshConfig)
		if err != nil {
			return nil, err
		}
		refresh = r
	}
	return &TokenService{access: access, refresh: refresh}, nil
}

// Access exposes the underlying access service for middleware that only
// needs to validate tokens (e.g. the auth middleware).
func (s *TokenService) Access() *AccessTokenService { return s.access }

// IssuePair issues a fresh access + refresh pair. Used after successful
// login / register.
func (s *TokenService) IssuePair(ctx context.Context, userID int64, username string) (TokenPair, error) {
	access, err := s.access.Generate(userID, username)
	if err != nil {
		return TokenPair{}, fmt.Errorf("issue access token: %w", err)
	}
	refresh, err := s.refresh.Issue(ctx, userID)
	if err != nil {
		return TokenPair{}, fmt.Errorf("issue refresh token: %w", err)
	}
	return TokenPair{
		AccessToken:            access,
		RefreshToken:           refresh,
		AccessExpiresInSeconds: s.access.ExpirationSeconds(),
	}, nil
}

// Refresh rotates a presented refresh token and mints a new access token for
// the user. The caller is responsible for fetching the user (we only have
// the ID at this point — the refresh token doesn't carry the username).
func (s *TokenService) Refresh(ctx context.Context, presented string, lookupUsername func(ctx context.Context, userID int64) (string, error)) (TokenPair, error) {
	newRaw, userID, err := s.refresh.Exchange(ctx, presented)
	if err != nil {
		return TokenPair{}, err
	}

	username, err := lookupUsername(ctx, userID)
	if err != nil {
		return TokenPair{}, fmt.Errorf("look up user during refresh: %w", err)
	}

	access, err := s.access.Generate(userID, username)
	if err != nil {
		return TokenPair{}, fmt.Errorf("issue new access token: %w", err)
	}
	return TokenPair{
		AccessToken:            access,
		RefreshToken:           newRaw,
		AccessExpiresInSeconds: s.access.ExpirationSeconds(),
	}, nil
}

// Revoke invalidates a refresh token. Used by /logout. The associated access
// token remains valid until its short-lived expiration.
func (s *TokenService) Revoke(ctx context.Context, presented string) error {
	return s.refresh.Revoke(ctx, presented)
}
