// Package bootstrap performs one-time launch-time setup that needs the
// database to be reachable but should never block the server from serving.
package bootstrap

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
)

// bootstrapTokenDescription tags the launch-time token so we can recognize and
// reuse it on subsequent restarts instead of spawning a new one each time.
const bootstrapTokenDescription = "first-admin bootstrap"

// bootstrapTokenTTL is how long the minted token stays valid. A week gives an
// operator ample time to register the first admin without leaving a usable
// registration token lying around forever.
const bootstrapTokenTTL = 7 * 24 * time.Hour

// EnsureAdminInviteToken guarantees that a fresh deployment (zero users) has a
// way to register its first admin: it mints a single-use invitation token and
// logs it for the operator. The ensure_first_user_is_admin trigger promotes
// whoever registers first, so the holder of this token becomes the admin.
//
// It is a no-op once any user exists. To avoid spawning a new token on every
// restart of an still-empty deployment, it reuses an existing active bootstrap
// token when one is present.
func EnsureAdminInviteToken(ctx context.Context, q *store.Queries) error {
	n, err := q.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("counting users: %w", err)
	}
	if n > 0 {
		// System already has users — nothing to bootstrap.
		return nil
	}

	if reused, err := reuseExistingToken(ctx, q); err != nil {
		return err
	} else if reused {
		return nil
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fmt.Errorf("generating bootstrap token: %w", err)
	}
	tokenValue := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().Add(bootstrapTokenTTL)
	tk, err := q.CreateInvitationToken(ctx, store.CreateInvitationTokenParams{
		Token:       tokenValue,
		Description: bootstrapTokenDescription,
		MaxUses:     1,
		ExpiresAt:   expiresAt,
	})
	if err != nil {
		return fmt.Errorf("creating bootstrap token: %w", err)
	}

	logger.LogInfo("no users found — created bootstrap admin registration token",
		"token", tk.Token,
		"expires_at", tk.ExpiresAt.Format(time.RFC3339),
		"max_uses", tk.MaxUses,
	)
	return nil
}

// reuseExistingToken looks for an active (unexpired, unused) bootstrap token
// and, if found, reprints it and reports true. This keeps restarts of an empty
// deployment from accumulating tokens.
func reuseExistingToken(ctx context.Context, q *store.Queries) (bool, error) {
	tokens, err := q.ListInvitationTokens(ctx)
	if err != nil {
		return false, fmt.Errorf("listing invitation tokens: %w", err)
	}

	now := time.Now()
	for _, t := range tokens {
		if t.Description != bootstrapTokenDescription {
			continue
		}
		if !now.Before(t.ExpiresAt) {
			continue // expired
		}
		uses, err := q.CountUsesOfInvitationToken(ctx, t.ID)
		if err != nil {
			return false, fmt.Errorf("counting uses of token %d: %w", t.ID, err)
		}
		if uses >= int64(t.MaxUses) {
			continue // exhausted
		}

		logger.LogInfo("no users found — reusing existing bootstrap admin registration token",
			"token", t.Token,
			"expires_at", t.ExpiresAt.Format(time.RFC3339),
			"max_uses", t.MaxUses,
		)
		return true, nil
	}
	return false, nil
}
