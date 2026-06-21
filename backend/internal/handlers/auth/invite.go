package auth

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// inviteContextView is the public, non-secret description of an invite link: it
// tells a prospective registrant what they are about to join so the register
// page can show "Вы вступаете в «…» как ученик группы А". The token value
// itself is the bearer secret and is supplied by the caller, so echoing its
// description/role discloses nothing new.
type inviteContextView struct {
	Valid       bool   `json:"valid"`
	Description string `json:"description"`
	Role        string `json:"role,omitempty"` // "teacher" | "student" | "" (plain token)
	CenterName  string `json:"center_name,omitempty"`
	GroupName   string `json:"group_name,omitempty"`
}

// InviteLookup resolves an invitation token by value for the registration page.
// It never requires auth. An unknown token returns 404 with valid=false; an
// existing one returns whether it is still usable plus the enrollment it grants.
func InviteLookup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		q := store.New(database.Pool())

		token := chi.URLParam(r, "token")
		if token == "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "token required")
			return
		}

		invitation, err := q.GetInvitationTokenByValue(ctx, token)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteJSON(w, http.StatusNotFound, inviteContextView{Valid: false})
				return
			}
			logger.LogErrorContext(ctx, "invite: fetch token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		view := inviteContextView{Description: invitation.Description, Valid: true}

		// Usable = not expired AND not exhausted.
		if time.Now().After(invitation.ExpiresAt) {
			view.Valid = false
		} else if uses, err := q.CountUsesOfInvitationToken(ctx, invitation.ID); err == nil {
			if uses >= int64(invitation.MaxUses) {
				view.Valid = false
			}
		}

		preset, err := tokenpreset.Parse(invitation.Preset)
		if err != nil {
			// A malformed/old preset still yields a valid-but-plain invite view.
			httpx.WriteJSON(w, http.StatusOK, view)
			return
		}

		switch {
		case preset.MathCenterTeacher != nil:
			view.Role = "teacher"
			if c, err := q.GetMathCenter(ctx, preset.MathCenterTeacher.CenterID); err == nil {
				view.CenterName = centerName(int(c.GraduationYear))
			}
		case preset.MathCenterStudent != nil:
			view.Role = "student"
			if g, err := q.GetGroup(ctx, preset.MathCenterStudent.GroupID); err == nil {
				view.GroupName = g.Name
				if c, err := q.GetMathCenter(ctx, g.MathCenterID); err == nil {
					view.CenterName = centerName(int(c.GraduationYear))
				}
			}
		}

		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// centerName formats a center's display label the same way the nav does.
func centerName(graduationYear int) string {
	return "Матцентр " + strconv.Itoa(graduationYear)
}
