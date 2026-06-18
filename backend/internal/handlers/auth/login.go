package auth

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type LoginRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50"`
	Password string `json:"password" validate:"required,min=1,max=128"`
}

type LoginResponse struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	TokenType    string     `json:"token_type"`
	ExpiresIn    int        `json:"expires_in"`
	User         store.User `json:"user"`
}

// Login authenticates a user by username + password and returns access +
// refresh tokens.
//
// The password min-length validator is intentionally weaker than registration
// (min=1, not min=8): we must accept whatever the user previously registered
// with, even if policy has tightened since.
func Login(database *db.DB, tokens *auth.TokenService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var req LoginRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if err := validate.Struct(req); err != nil {
			httpx.WriteValidationError(w, r, err)
			return
		}

		// Usernames are stored lowercase (see register), so normalize the
		// lookup key to match regardless of how the user typed it.
		username := strings.ToLower(strings.TrimSpace(req.Username))

		user, err := store.New(database.Pool()).GetUserByUsername(ctx, username)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeInvalidCredentials, "invalid username or password")
				return
			}
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "login failed")
			return
		}

		if err := auth.CheckPassword(req.Password, user.PasswordHash); err != nil {
			httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeInvalidCredentials, "invalid username or password")
			return
		}

		pair, err := tokens.IssuePair(ctx, user.ID, user.Username, user.IsAdmin)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to issue token")
			return
		}

		httpx.WriteJSON(w, http.StatusOK, LoginResponse{
			AccessToken:  pair.AccessToken,
			RefreshToken: pair.RefreshToken,
			TokenType:    "Bearer",
			ExpiresIn:    pair.AccessExpiresInSeconds,
			User:         user,
		})
	}
}
