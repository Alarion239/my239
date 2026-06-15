package auth

import (
	"context"
	"errors"
	"net/http"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type RefreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// Refresh exchanges a presented refresh token for a new access + refresh
// pair (rotation). The presented token is invalidated as part of the
// exchange — replaying it returns an error.
func Refresh(database *db.DB, tokens *internalAuth.TokenService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RefreshRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if err := validate.Struct(req); err != nil {
			httpx.WriteValidationError(w, r, err)
			return
		}

		lookupUser := func(ctx context.Context, userID int64) (internalAuth.RefreshUser, error) {
			u, err := store.New(database.Pool()).GetUserByID(ctx, userID)
			if err != nil {
				return internalAuth.RefreshUser{}, err
			}
			return internalAuth.RefreshUser{Username: u.Username, IsAdmin: u.IsAdmin}, nil
		}

		pair, err := tokens.Refresh(r.Context(), req.RefreshToken, lookupUser)
		if err != nil {
			switch {
			case errors.Is(err, internalAuth.ErrRefreshTokenInvalid):
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenInvalid, "invalid refresh token")
			case errors.Is(err, internalAuth.ErrRefreshTokenExpired):
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenExpired, "refresh token expired")
			case errors.Is(err, internalAuth.ErrRefreshTokenRevoked):
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenInvalid, "refresh token revoked")
			default:
				logger.LogErrorContext(r.Context(), "refresh: exchange", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			}
			return
		}

		httpx.WriteJSON(w, http.StatusOK, RefreshResponse{
			AccessToken:  pair.AccessToken,
			RefreshToken: pair.RefreshToken,
			TokenType:    "Bearer",
			ExpiresIn:    pair.AccessExpiresInSeconds,
		})
	}
}
