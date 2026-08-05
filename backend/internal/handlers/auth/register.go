package auth

import (
	"context"
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

		preset, err := tokenpreset.Parse(invitation.Preset)
		if err != nil {
			logger.LogErrorContext(ctx, "register: parse token preset", err, "token_id", invitation.ID)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// Usernames are stored and looked up case-insensitively: normalize to
		// lowercase here so registration, login and the DB CHECK constraint all
		// agree (validation above already guaranteed it is alphanumeric).
		username := strings.ToLower(strings.TrimSpace(req.Username))

		var user store.User
		claimedSheetsStudent := false
		var claimedStudentGroups []int64
		personalSheetsClaim := preset.MathCenterStudentClaim != nil
		switch {
		case personalSheetsClaim:
			if invitation.MathCenterID == nil {
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
				return
			}
			user, claimedSheetsStudent, err = claimSheetsStudentByID(
				ctx,
				tx,
				preset.MathCenterStudentClaim.UserID,
				*invitation.MathCenterID,
				username,
				passwordHash,
				invitation.ID,
			)
			if err == nil && !claimedSheetsStudent {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "student account has already been claimed or is no longer in this math center")
				return
			}
		case len(preset.MathCenterStudents) > 0:
			user, claimedSheetsStudent, claimedStudentGroups, err = claimUniqueSheetsStudentInGroups(
				ctx,
				tx,
				preset.MathCenterStudents,
				req.FirstName,
				req.LastName,
				username,
				passwordHash,
				invitation.ID,
			)
		case preset.MathCenterStudent != nil:
			user, claimedSheetsStudent, err = claimUniqueSheetsStudent(
				ctx,
				tx,
				preset.MathCenterStudent.GroupID,
				req.FirstName,
				req.LastName,
				username,
				passwordHash,
				invitation.ID,
			)
		}
		if err == nil && !claimedSheetsStudent && !personalSheetsClaim {
			user, err = q.CreateUser(ctx, store.CreateUserParams{
				Username:          username,
				PasswordHash:      passwordHash,
				FirstName:         req.FirstName,
				MiddleName:        req.MiddleName,
				LastName:          req.LastName,
				InvitationTokenID: &invitation.ID,
			})
		}
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "username already taken")
				return
			}
			logger.LogErrorContext(ctx, "register: create or claim user", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		// The invitation token carries a server-enforced preset (admin grant,
		// math-center enrollment). Apply it inside the same transaction so the
		// grants commit atomically with the user — or not at all.
		presetToApply := preset
		if claimedSheetsStudent {
			// The placeholder already owns the exact group enrollment and all of
			// its student history. Apply any other grants on the invitation, but
			// do not try to insert that enrollment a second time.
			presetToApply.MathCenterStudent = nil
			presetToApply.MathCenterStudentClaim = nil
			if len(claimedStudentGroups) > 0 {
				claimed := make(map[int64]struct{}, len(claimedStudentGroups))
				for _, groupID := range claimedStudentGroups {
					claimed[groupID] = struct{}{}
				}
				remaining := make([]tokenpreset.MathCenterStudent, 0, len(presetToApply.MathCenterStudents))
				for _, student := range presetToApply.MathCenterStudents {
					if _, ok := claimed[student.GroupID]; !ok {
						remaining = append(remaining, student)
					}
				}
				presetToApply.MathCenterStudents = remaining
			}
		}
		if err := tokenpreset.Apply(ctx, q, user.ID, presetToApply); err != nil {
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

// claimSheetsStudentByID activates the exact unavailable Sheets account named
// by a personal invitation. The center check is repeated at consumption time,
// so moving or removing the student cannot leave a stale bearer link capable
// of claiming an unrelated account.
func claimSheetsStudentByID(
	ctx context.Context,
	tx pgx.Tx,
	userID int64,
	centerID int64,
	username string,
	passwordHash string,
	invitationTokenID int64,
) (store.User, bool, error) {
	const query = `
		UPDATE users AS user_row
		SET username = $3,
		    password_hash = $4,
		    invitation_token_id = $5,
		    updated_at = NOW()
		WHERE user_row.id = $1
		  AND user_row.username LIKE 'sheets-%'
		  AND user_row.invitation_token_id IS NULL
		  AND NOT user_row.is_math_center
		  AND EXISTS (
		      SELECT 1
		      FROM math_center_students student
		      JOIN math_center_groups group_row ON group_row.id = student.group_id
		      WHERE student.user_id = user_row.id
		        AND group_row.math_center_id = $2
		  )
		RETURNING id, username, password_hash, first_name, middle_name, last_name,
		          invitation_token_id, created_at, updated_at, is_admin, is_math_center`

	var user store.User
	err := tx.QueryRow(ctx, query, userID, centerID, username, passwordHash, invitationTokenID).Scan(
		&user.ID,
		&user.Username,
		&user.PasswordHash,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsAdmin,
		&user.IsMathCenter,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.User{}, false, nil
	}
	if err != nil {
		return store.User{}, false, err
	}
	return user, true, nil
}

// claimUniqueSheetsStudent activates an unavailable account provisioned by
// Google Sheets when exactly one such account in the invitation's group has
// the submitted first and last name. Ordinary usernames cannot contain '-'
// (registration validation is alphanumeric), so the generated "sheets-"
// namespace plus a NULL invitation lineage identifies these placeholders.
//
// The lookup and update run inside the invitation-locked registration
// transaction. FOR UPDATE prevents two registrations from claiming the same
// placeholder concurrently; LIMIT 2 is enough to distinguish one match from
// an ambiguous name without loading every duplicate.
func claimUniqueSheetsStudent(
	ctx context.Context,
	tx pgx.Tx,
	groupID int64,
	firstName string,
	lastName string,
	username string,
	passwordHash string,
	invitationTokenID int64,
) (store.User, bool, error) {
	const findQuery = `
		SELECT u.id
		FROM users u
		JOIN math_center_students student ON student.user_id = u.id
		WHERE student.group_id = $1
		  AND u.username LIKE 'sheets-%'
		  AND u.invitation_token_id IS NULL
		  AND NOT u.is_math_center
		  AND lower(regexp_replace(btrim(u.first_name), '[[:space:]]+', ' ', 'g')) =
		      lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
		  AND lower(regexp_replace(btrim(u.last_name), '[[:space:]]+', ' ', 'g')) =
		      lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
		ORDER BY u.id
		LIMIT 2
		FOR UPDATE OF u`

	rows, err := tx.Query(ctx, findQuery, groupID, firstName, lastName)
	if err != nil {
		return store.User{}, false, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return store.User{}, false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return store.User{}, false, err
	}
	if len(ids) != 1 {
		return store.User{}, false, nil
	}

	const claimQuery = `
		UPDATE users
		SET username = $2,
		    password_hash = $3,
		    invitation_token_id = $4,
		    updated_at = NOW()
		WHERE id = $1
		  AND username LIKE 'sheets-%'
		  AND invitation_token_id IS NULL
		RETURNING id, username, password_hash, first_name, middle_name, last_name,
		          invitation_token_id, created_at, updated_at, is_admin, is_math_center`

	var user store.User
	err = tx.QueryRow(ctx, claimQuery, ids[0], username, passwordHash, invitationTokenID).Scan(
		&user.ID,
		&user.Username,
		&user.PasswordHash,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsAdmin,
		&user.IsMathCenter,
	)
	if err != nil {
		return store.User{}, false, err
	}
	return user, true, nil
}

// claimUniqueSheetsStudentInGroups activates one unclaimed Sheets placeholder
// when the submitted name matches exactly one placeholder across all invited
// groups. It returns the groups the placeholder already owns so registration
// can apply only the remaining grants.
func claimUniqueSheetsStudentInGroups(
	ctx context.Context,
	tx pgx.Tx,
	students []tokenpreset.MathCenterStudent,
	firstName string,
	lastName string,
	username string,
	passwordHash string,
	invitationTokenID int64,
) (store.User, bool, []int64, error) {
	groupIDs := make([]int64, 0, len(students))
	for _, student := range students {
		groupIDs = append(groupIDs, student.GroupID)
	}
	const findQuery = `
		SELECT u.id
		FROM users u
		JOIN math_center_students student ON student.user_id = u.id
		WHERE student.group_id = ANY($1::bigint[])
		  AND u.username LIKE 'sheets-%'
		  AND u.invitation_token_id IS NULL
		  AND NOT u.is_math_center
		  AND lower(regexp_replace(btrim(u.first_name), '[[:space:]]+', ' ', 'g')) =
		      lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
		  AND lower(regexp_replace(btrim(u.last_name), '[[:space:]]+', ' ', 'g')) =
		      lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
		GROUP BY u.id
		ORDER BY u.id
		LIMIT 2`
	rows, err := tx.Query(ctx, findQuery, groupIDs, firstName, lastName)
	if err != nil {
		return store.User{}, false, nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return store.User{}, false, nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return store.User{}, false, nil, err
	}
	if len(ids) != 1 {
		return store.User{}, false, nil, nil
	}

	const claimQuery = `
		UPDATE users
		SET username = $2,
		    password_hash = $3,
		    invitation_token_id = $4,
		    updated_at = NOW()
		WHERE id = $1
		  AND username LIKE 'sheets-%'
		  AND invitation_token_id IS NULL
		RETURNING id, username, password_hash, first_name, middle_name, last_name,
		          invitation_token_id, created_at, updated_at, is_admin, is_math_center`
	var user store.User
	err = tx.QueryRow(ctx, claimQuery, ids[0], username, passwordHash, invitationTokenID).Scan(
		&user.ID,
		&user.Username,
		&user.PasswordHash,
		&user.FirstName,
		&user.MiddleName,
		&user.LastName,
		&user.InvitationTokenID,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsAdmin,
		&user.IsMathCenter,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.User{}, false, nil, nil
	}
	if err != nil {
		return store.User{}, false, nil, err
	}

	const groupsQuery = `
		SELECT group_id
		FROM math_center_students
		WHERE user_id = $1
		  AND group_id = ANY($2::bigint[])`
	groupRows, err := tx.Query(ctx, groupsQuery, user.ID, groupIDs)
	if err != nil {
		return store.User{}, false, nil, err
	}
	defer groupRows.Close()
	claimedGroups := make([]int64, 0)
	for groupRows.Next() {
		var groupID int64
		if err := groupRows.Scan(&groupID); err != nil {
			return store.User{}, false, nil, err
		}
		claimedGroups = append(claimedGroups, groupID)
	}
	if err := groupRows.Err(); err != nil {
		return store.User{}, false, nil, err
	}
	return user, true, claimedGroups, nil
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
