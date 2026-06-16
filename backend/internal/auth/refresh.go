package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Errors surfaced from refresh-token operations. Handlers map these to API
// error codes.
var (
	ErrRefreshTokenInvalid = errors.New("refresh token invalid")
	ErrRefreshTokenExpired = errors.New("refresh token expired")
	ErrRefreshTokenRevoked = errors.New("refresh token revoked or rotated")
)

// hashRefreshToken returns the storage representation of a raw refresh
// token: SHA-256 of the bytes. We never store plaintext.
func hashRefreshToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

// RefreshTokenService issues, validates, rotates, and revokes opaque refresh
// tokens. It depends on a *db.DB so it can begin its own transactions for
// atomic rotation.
type RefreshTokenService struct {
	db         *db.DB
	expiration time.Duration
	now        func() time.Time
}

type RefreshTokenConfig struct {
	DB         *db.DB
	Expiration time.Duration
}

func NewRefreshTokenService(cfg RefreshTokenConfig) (*RefreshTokenService, error) {
	if cfg.DB == nil {
		return nil, errors.New("refresh token service: db must not be nil")
	}
	if cfg.Expiration <= 0 {
		return nil, errors.New("refresh token expiration must be positive")
	}
	return &RefreshTokenService{
		db:         cfg.DB,
		expiration: cfg.Expiration,
		now:        time.Now,
	}, nil
}

// Issue creates a fresh refresh token for the given user, persists its hash,
// and returns the raw value. The plaintext is the only time the caller will
// ever see it.
func (s *RefreshTokenService) Issue(ctx context.Context, userID int64) (string, error) {
	raw, err := randomHex(32)
	if err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	_, err = store.New(s.db.Pool()).CreateRefreshToken(ctx, store.CreateRefreshTokenParams{
		UserID:    userID,
		TokenHash: hashRefreshToken(raw),
		ExpiresAt: s.now().Add(s.expiration),
	})
	if err != nil {
		return "", fmt.Errorf("persist refresh token: %w", err)
	}
	return raw, nil
}

// Exchange consumes a presented refresh token and atomically rotates it
// (revokes the old, issues a new). Replaying a presented token returns an
// error.
func (s *RefreshTokenService) Exchange(ctx context.Context, raw string) (newRaw string, userID int64, err error) {
	tx, err := s.db.Pool().Begin(ctx)
	if err != nil {
		return "", 0, fmt.Errorf("begin refresh tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := store.New(tx)
	old, err := q.GetRefreshTokenByHash(ctx, hashRefreshToken(raw))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", 0, ErrRefreshTokenInvalid
		}
		return "", 0, err
	}

	now := s.now()
	if old.RevokedAt != nil || old.ReplacedByID != nil {
		return "", 0, ErrRefreshTokenRevoked
	}
	if !now.Before(old.ExpiresAt) {
		return "", 0, ErrRefreshTokenExpired
	}

	newRaw, err = randomHex(32)
	if err != nil {
		return "", 0, fmt.Errorf("generate new refresh token: %w", err)
	}
	created, err := q.CreateRefreshToken(ctx, store.CreateRefreshTokenParams{
		UserID:    old.UserID,
		TokenHash: hashRefreshToken(newRaw),
		ExpiresAt: now.Add(s.expiration),
	})
	if err != nil {
		return "", 0, err
	}
	if err := q.RotateRefreshToken(ctx, store.RotateRefreshTokenParams{
		ID:           old.ID,
		ReplacedByID: &created.ID,
	}); err != nil {
		return "", 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", 0, fmt.Errorf("commit refresh tx: %w", err)
	}
	return newRaw, old.UserID, nil
}

// Revoke invalidates a presented refresh token. Idempotent: unknown tokens
// are treated as already-revoked rather than leaking existence.
func (s *RefreshTokenService) Revoke(ctx context.Context, raw string) error {
	q := store.New(s.db.Pool())
	rt, err := q.GetRefreshTokenByHash(ctx, hashRefreshToken(raw))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	return q.RevokeRefreshTokenByID(ctx, rt.ID)
}

// RevokeAllForUser invalidates every active refresh token for a user.
func (s *RefreshTokenService) RevokeAllForUser(ctx context.Context, userID int64) error {
	return store.New(s.db.Pool()).RevokeAllRefreshTokensForUser(ctx, userID)
}
