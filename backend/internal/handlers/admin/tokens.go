package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// TokenView is the wire representation of an invitation token. It mirrors the
// store.InvitationToken struct plus a derived `uses` count so the frontend
// doesn't have to fan out one query per row.
type TokenView struct {
	ID          int64           `json:"id"`
	Token       string          `json:"token"`
	Description string          `json:"description"`
	MaxUses     int32           `json:"max_uses"`
	Uses        int64           `json:"uses"`
	ExpiresAt   time.Time       `json:"expires_at"`
	CreatedAt   time.Time       `json:"created_at"`
	Preset      json.RawMessage `json:"preset"`
	// MathCenterID scopes a token to one center (head-teacher invites). NULL for
	// global admin-minted tokens.
	MathCenterID *int64 `json:"math_center_id,omitempty"`
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
			logger.LogErrorContext(r.Context(), "admin: list tokens", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list tokens")
			return
		}

		out := make([]TokenView, 0, len(tokens))
		for _, t := range tokens {
			uses, err := q.CountUsesOfInvitationToken(ctx, t.ID)
			if err != nil {
				logger.LogErrorContext(r.Context(), "admin: count token uses", err, "token_id", t.ID)
				uses = 0
			}
			out = append(out, TokenView{
				ID:           t.ID,
				Token:        t.Token,
				Description:  t.Description,
				MaxUses:      t.MaxUses,
				Uses:         uses,
				ExpiresAt:    t.ExpiresAt,
				CreatedAt:    t.CreatedAt,
				Preset:       t.Preset,
				MathCenterID: t.MathCenterID,
			})
		}

		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

type createTokenRequest struct {
	Description    string          `json:"description"`
	MaxUses        int32           `json:"max_uses"`
	ExpiresInHours int             `json:"expires_in_hours"`
	Preset         json.RawMessage `json:"preset"`
}

// CreateToken mints a fresh invitation token. The token value is a 32-byte
// cryptographically random hex string — we never let the caller pick it.
func CreateToken(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createTokenRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
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

		// Decode and validate the (optional) preset before minting the token,
		// so an admin cannot create a token that references a non-existent
		// group/center or is internally contradictory. An omitted preset stays
		// the empty "{}" — a plain invitation token.
		preset, err := tokenpreset.Parse(req.Preset)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		if err := tokenpreset.Validate(r.Context(), store.New(database.Pool()), preset); err != nil {
			if errors.Is(err, tokenpreset.ErrInvalidPreset) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
				return
			}
			logger.LogErrorContext(r.Context(), "admin: validate token preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create token")
			return
		}
		presetJSON, err := tokenpreset.Marshal(preset)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin: marshal token preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create token")
			return
		}

		raw, err := randomHex(32)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin: random token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to generate token")
			return
		}

		tok, err := store.New(database.Pool()).CreateInvitationToken(r.Context(), store.CreateInvitationTokenParams{
			Token:        raw,
			Description:  req.Description,
			MaxUses:      req.MaxUses,
			ExpiresAt:    time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour),
			Preset:       presetJSON,
			MathCenterID: nil,
		})
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin: create token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create token")
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, TokenView{
			ID:           tok.ID,
			Token:        tok.Token,
			Description:  tok.Description,
			MaxUses:      tok.MaxUses,
			Uses:         0,
			ExpiresAt:    tok.ExpiresAt,
			CreatedAt:    tok.CreatedAt,
			Preset:       tok.Preset,
			MathCenterID: tok.MathCenterID,
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
			logger.LogErrorContext(r.Context(), "admin: revoke token", err)
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
