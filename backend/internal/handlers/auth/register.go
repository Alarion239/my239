package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type RegisterRequest struct {
	Username        string  `json:"username" validate:"required,min=3,max=50,alphanum"`
	Password        string  `json:"password" validate:"required,min=8,max=128"`
	InvitationToken string  `json:"invitation_token" validate:"required"`
	FirstName       string  `json:"first_name" validate:"required,max=255"`
	MiddleName      *string `json:"middle_name" validate:"omitempty,max=255"`
	LastName        string  `json:"last_name" validate:"max=255"`
}

type RegisterResponse struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	TokenType    string     `json:"token_type"`
	ExpiresIn    int        `json:"expires_in"`
	User         store.User `json:"user"`
}

// Register creates a new user behind a SELECT ... FOR UPDATE lock on the
// invitation token, so two concurrent registrations with the same token
// cannot both exceed max_uses.
func Register(database *db.DB, tokens *auth.TokenService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var req RegisterRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if err := validate.Struct(req); err != nil {
			httpx.WriteValidationError(w, r, err)
			return
		}

		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "register: begin tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		q := store.New(tx)

		invitation, err := q.GetInvitationTokenByValueForUpdate(ctx, req.InvitationToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenInvalid, "invalid invitation token")
				return
			}
			logger.LogErrorContext(ctx, "register: fetch token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		if time.Now().After(invitation.ExpiresAt) {
			httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenExpired, "invitation token has expired")
			return
		}

		uses, err := q.CountUsesOfInvitationToken(ctx, invitation.ID)
		if err != nil {
			logger.LogErrorContext(ctx, "register: count token uses", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if uses >= int64(invitation.MaxUses) {
			httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeTokenExhausted, "invitation token has reached maximum uses")
			return
		}

		// Usernames are stored and looked up case-insensitively: normalize to
		// lowercase here so registration, login and the DB CHECK constraint all
		// agree (validation above already guaranteed it is alphanumeric).
		username := strings.ToLower(strings.TrimSpace(req.Username))

		user, err := q.CreateUser(ctx, store.CreateUserParams{
			Username:          username,
			PasswordHash:      passwordHash,
			FirstName:         req.FirstName,
			MiddleName:        req.MiddleName,
			LastName:          req.LastName,
			InvitationTokenID: &invitation.ID,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "username already taken")
				return
			}
			logger.LogErrorContext(ctx, "register: create user", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// The invitation token carries a server-enforced preset (admin grant,
		// math-center enrollment). Apply it inside the same transaction so the
		// grants commit atomically with the user — or not at all.
		preset, err := tokenpreset.Parse(invitation.Preset)
		if err != nil {
			logger.LogErrorContext(ctx, "register: parse token preset", err, "token_id", invitation.ID)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if err := tokenpreset.Apply(ctx, q, user.ID, preset); err != nil {
			switch {
			case errors.Is(err, tokenpreset.ErrConflict):
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, err.Error())
			case errors.Is(err, tokenpreset.ErrInvalidPreset):
				httpx.WriteAPIError(w, r, http.StatusUnprocessableEntity, httpx.CodeBadRequest, err.Error())
			default:
				logger.LogErrorContext(ctx, "register: apply token preset", err, "token_id", invitation.ID)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			}
			return
		}
		// Reflect the admin grant on the user the handler returns and signs into
		// the access token (the CreateUser row predates SetUserAdmin).
		if preset.GrantsAdmin {
			user.IsAdmin = true
		}

		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "register: commit tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		pair, err := tokens.IssuePair(ctx, user.ID, user.Username, user.IsAdmin)
		if err != nil {
			logger.LogErrorContext(ctx, "register: issue token pair", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to issue token")
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, RegisterResponse{
			AccessToken:  pair.AccessToken,
			RefreshToken: pair.RefreshToken,
			TokenType:    "Bearer",
			ExpiresIn:    pair.AccessExpiresInSeconds,
			User:         user,
		})
	}
}

// isUniqueViolation reports whether err is a Postgres unique-constraint
// violation (SQLSTATE 23505) — used to translate the username-collision
// error into a 409.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23505"
}
