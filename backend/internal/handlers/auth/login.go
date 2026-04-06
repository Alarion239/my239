package auth

import (
	"encoding/json"
	"net/http"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/models/common"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-playground/validator/v10"
)

type LoginRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50"`
	Password string `json:"password" validate:"required,min=8,max=128"`
}

type LoginResponse struct {
	Token string      `json:"token"`
	User  common.User `json:"user"`
}

// Login handles user authentication.
func Login(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var req LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		validate := validator.New()
		if err := validate.Struct(req); err != nil {
			http.Error(w, "Validation failed: "+err.Error(), http.StatusBadRequest)
			return
		}

		user, err := common.NewUserRepo(database).GetByUsernameWithHash(ctx, req.Username)
		if err != nil {
			http.Error(w, "Invalid username or password", http.StatusUnauthorized)
			return
		}

		if err := auth.CheckPassword(req.Password, user.PasswordHash); err != nil {
			http.Error(w, "Invalid username or password", http.StatusUnauthorized)
			return
		}

		token, err := auth.GenerateJWT(user.ID, user.Username)
		if err != nil {
			http.Error(w, "Failed to generate authentication token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		err = json.NewEncoder(w).Encode(LoginResponse{Token: token, User: user.User})
		if err != nil {
			return
		}
	}
}
