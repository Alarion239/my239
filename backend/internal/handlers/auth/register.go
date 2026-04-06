package auth

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/models/authorize"
	"github.com/Alarion239/my239/backend/models/common"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-playground/validator/v10"
)

type RegisterRequest struct {
	Username        string  `json:"username" validate:"required,min=3,max=50,alphanum"`
	Password        string  `json:"password" validate:"required,min=8,max=128"`
	InvitationToken string  `json:"invitation_token" validate:"required"`
	FirstName       string  `json:"first_name" validate:"required,max=255"`
	MiddleName      *string `json:"middle_name" validate:"max=255"`
	LastName        string  `json:"last_name" validate:"max=255"`
}

type RegisterResponse struct {
	Token string      `json:"token"`
	User  common.User `json:"user"`
}

// Register handles user registration.
func Register(database *db.DB, jwtSvc *auth.JWTService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var req RegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		validate := validator.New()
		if err := validate.Struct(req); err != nil {
			http.Error(w, "Validation failed: "+err.Error(), http.StatusBadRequest)
			return
		}

		tokenRepo := authorize.NewInvitationTokenRepo(database)

		invitationToken, err := tokenRepo.GetByToken(ctx, req.InvitationToken)
		if err != nil {
			http.Error(w, "Invalid invitation token", http.StatusUnauthorized)
			return
		}

		if time.Now().After(invitationToken.ExpiresAt) {
			http.Error(w, "Invitation token has expired", http.StatusUnauthorized)
			return
		}

		tokenUses, err := tokenRepo.CountUsesOfToken(ctx, invitationToken.ID)
		if err != nil {
			http.Error(w, "Failed to count token uses", http.StatusInternalServerError)
			return
		}

		if tokenUses >= invitationToken.MaxUses {
			http.Error(w, "Invitation token has reached maximum uses", http.StatusUnauthorized)
			return
		}

		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			http.Error(w, "Failed to process password", http.StatusInternalServerError)
			return
		}

		user, err := common.NewUserRepo(database).Create(
			ctx, req.Username, req.FirstName, req.MiddleName, req.LastName, invitationToken.ID, passwordHash,
		)
		if err != nil {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
			return
		}

		token, err := jwtSvc.Generate(user.ID, req.Username)
		if err != nil {
			http.Error(w, "Failed to generate authentication token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		err = json.NewEncoder(w).Encode(RegisterResponse{Token: token, User: *user})
		if err != nil {
			return
		}
	}
}
