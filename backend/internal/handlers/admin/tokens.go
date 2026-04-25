package admin

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"time"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
)

// TokenView is the wire representation of an invitation token. It mirrors the
// store.InvitationToken struct plus a derived `uses` count so the frontend
// doesn't have to fan out one query per row.
type TokenView struct {
	ID          int64     `json:"id"`
	Token       string    `json:"token"`
	Description string    `json:"description"`
	MaxUses     int32     `json:"max_uses"`
	Uses        int64     `json:"uses"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// ListTokens returns every invitation token, including the consumed-uses
// count. N+1 queries are intentional: the token table is small (admin-only,
// human-curated) and a JOIN would obscure the simple semantics.
func ListTokens(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := store.New(database.Pool())

		tokens, err := q.ListInvitationTokens(ctx)
		if err != nil {
			logger.LogError("admin: list tokens", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list tokens")
			return
		}

		out := make([]TokenView, 0, len(tokens))
		for _, t := range tokens {
			uses, err := q.CountUsesOfInvitationToken(ctx, t.ID)
			if err != nil {
				logger.LogError("admin: count token uses", err, "token_id", t.ID)
				uses = 0
			}
			out = append(out, TokenView{
				ID:          t.ID,
				Token:       t.Token,
				Description: t.Description,
				MaxUses:     t.MaxUses,
				Uses:        uses,
				ExpiresAt:   t.ExpiresAt,
				CreatedAt:   t.CreatedAt,
			})
		}

		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

type createTokenRequest struct {
	Description    string `json:"description"`
	MaxUses        int32  `json:"max_uses"`
	ExpiresInHours int    `json:"expires_in_hours"`
}

// CreateToken mints a fresh invitation token. The token value is a 32-byte
// cryptographically random hex string — we never let the caller pick it.
func CreateToken(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createTokenRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		if req.MaxUses <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "max_uses must be > 0")
			return
		}
		if req.ExpiresInHours <= 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "expires_in_hours must be > 0")
			return
		}
		if len(req.Description) > 255 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "description too long")
			return
		}

		raw, err := randomHex(32)
		if err != nil {
			logger.LogError("admin: random token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to generate token")
			return
		}

		tok, err := store.New(database.Pool()).CreateInvitationToken(r.Context(), store.CreateInvitationTokenParams{
			Token:       raw,
			Description: req.Description,
			MaxUses:     req.MaxUses,
			ExpiresAt:   time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour),
		})
		if err != nil {
			logger.LogError("admin: create token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create token")
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, TokenView{
			ID:          tok.ID,
			Token:       tok.Token,
			Description: tok.Description,
			MaxUses:     tok.MaxUses,
			Uses:        0,
			ExpiresAt:   tok.ExpiresAt,
			CreatedAt:   tok.CreatedAt,
		})
	}
}

// RevokeToken sets a token's expiry to NOW(), preventing further use.
// Idempotent: re-revoking returns 204.
func RevokeToken(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid token id")
			return
		}

		n, err := store.New(database.Pool()).RevokeInvitationTokenByID(r.Context(), id)
		if err != nil {
			logger.LogError("admin: revoke token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to revoke token")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "token not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// randomHex returns 2*n hex characters of cryptographically random data.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
