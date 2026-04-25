package auth

import (
	"net/http"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
)

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

// Logout revokes the presented refresh token. Returns 204 even if the token
// was already invalid, to avoid leaking which tokens exist.
//
// The associated access token remains valid until its short-lived expiry —
// for stricter semantics ("kill the session immediately") we'd need either
// a JTI blacklist or push the access TTL down further.
func Logout(tokens *internalAuth.TokenService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req LogoutRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		if err := validate.Struct(req); err != nil {
			httpx.WriteValidationError(w, r, err)
			return
		}

		if err := tokens.Revoke(r.Context(), req.RefreshToken); err != nil {
			logger.LogError("logout: revoke", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
