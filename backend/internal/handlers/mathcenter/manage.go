package mathcenter

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// ManageRouter is the head-teacher self-service panel, mounted under
// /centers/{centerID}/manage. Every handler re-checks head-teacher access (or
// admin) and that the target row belongs to {centerID}, so a head teacher of
// one center can never touch another center's rows via a guessed id.
func ManageRouter(database *db.DB, hub *live.Hub) chi.Router {
	r := chi.NewRouter()

	r.Get("/groups", manageListGroups(database))
	r.Post("/groups", manageCreateGroup(database, hub))
	r.Delete("/groups/{groupID}", manageDeleteGroup(database, hub))

	r.Get("/teachers", manageListTeachers(database))
	r.Post("/teachers", manageAddTeacher(database, hub))
	r.Patch("/teachers/{teacherID}/head", manageSetTeacherHead(database, hub))
	r.Delete("/teachers/{teacherID}", manageRemoveTeacher(database, hub))

	r.Get("/students", manageListStudents(database))
	r.Post("/students", manageAddStudent(database, hub))
	r.Patch("/students/{studentID}/group", manageSetStudentGroup(database, hub))
	r.Delete("/students/{studentID}", manageRemoveStudent(database, hub))

	r.Get("/user-search", manageUserSearch(database))

	r.Get("/invites", manageListInvites(database))
	r.Post("/invites", manageCreateInvite(database))
	r.Delete("/invites/{tokenID}", manageRevokeInvite(database))

	return r
}

// requireHeadTeacher gates the per-center management panel. Like requireTeacher
// it admits admins (effective is_admin) as a superset; otherwise the caller
// must be a HEAD teacher of {centerID}. On false it has already written the
// response.
func requireHeadTeacher(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID int64) bool {
	if callerIsAdmin(r) {
		return true
	}
	isHead, err := q.IsHeadTeacherInCenter(ctx, store.IsHeadTeacherInCenterParams{
		UserID: userID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "manage: head-teacher check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if !isHead {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "not a head teacher of this center")
		return false
	}
	return true
}

// manageGate resolves the {centerID} path param + the caller and runs the
// head-teacher check. On !ok the response is already written.
func manageGate(w http.ResponseWriter, r *http.Request, q *store.Queries) (centerID, userID int64, ok bool) {
	centerID, err := strconv.ParseInt(chi.URLParam(r, "centerID"), 10, 64)
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
		return 0, 0, false
	}
	userID, err = ctxcache.UserID(r.Context())
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusUnauthorized, httpx.CodeUnauthenticated, "unauthenticated")
		return 0, 0, false
	}
	if !requireHeadTeacher(r.Context(), w, r, q, userID, centerID) {
		return 0, 0, false
	}
	return centerID, userID, true
}

// Groups ---------------------------------------------------------------------

func manageListGroups(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		groups, err := q.ListGroupsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list groups", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list groups")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, groups)
	}
}

type manageCreateGroupRequest struct {
	Name string `json:"name"`
}

func manageCreateGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req manageCreateGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" || len(name) > 50 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "name must be 1–50 chars")
			return
		}
		group, err := q.CreateMathCenterGroup(r.Context(), store.CreateMathCenterGroupParams{
			MathCenterID: centerID, Name: name,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "group with that name already exists")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: create group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create group")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, group)
	}
}

func manageDeleteGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		groupID, err := strconv.ParseInt(chi.URLParam(r, "groupID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid group id")
			return
		}
		if !groupInCenter(w, r, q, groupID, centerID) {
			return
		}
		if _, err := q.DeleteMathCenterGroup(r.Context(), groupID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: delete group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete group")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Teachers -------------------------------------------------------------------

type manageAddTeacherRequest struct {
	UserID        int64 `json:"user_id"`
	IsHeadTeacher bool  `json:"is_head_teacher"`
}

type manageSetHeadRequest struct {
	IsHeadTeacher bool `json:"is_head_teacher"`
}

func manageListTeachers(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teachers, err := q.ListTeachersForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list teachers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list teachers")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, teachers)
	}
}

// manageAddTeacher enrolls an existing user as a teacher of {centerID}. Mirrors
// admin.AddTeacher: per-center exclusivity (no student+teacher of the same
// center) inside one transaction.
func manageAddTeacher(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		centerID, _, ok := manageGate(w, r, store.New(database.Pool()))
		if !ok {
			return
		}
		var req manageAddTeacherRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id required")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: begin add-teacher tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		isStudent, err := q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
			UserID: req.UserID, MathCenterID: centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "manage: add-teacher student check", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add teacher")
			return
		}
		if isStudent {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is a student of this center and cannot also teach it")
			return
		}

		t, err := q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
			UserID: req.UserID, MathCenterID: centerID, IsHeadTeacher: req.IsHeadTeacher,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a teacher of this center")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user does not exist")
				return
			}
			logger.LogErrorContext(ctx, "manage: add teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add teacher")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "manage: commit add-teacher tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, t)
	}
}

func manageSetTeacherHead(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teacherID, err := strconv.ParseInt(chi.URLParam(r, "teacherID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid teacher id")
			return
		}
		var req manageSetHeadRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		teacher, ok := teacherInCenter(w, r, q, teacherID, centerID)
		if !ok {
			return
		}
		// Demoting the last head teacher would lock the center out of its own
		// management panel.
		if !req.IsHeadTeacher && !guardLastHead(r.Context(), w, r, q, centerID, teacher) {
			return
		}
		if _, err := q.SetTeacherHead(r.Context(), store.SetTeacherHeadParams{
			ID: teacherID, IsHeadTeacher: req.IsHeadTeacher,
		}); err != nil {
			logger.LogErrorContext(r.Context(), "manage: set head", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update teacher")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageRemoveTeacher(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		teacherID, err := strconv.ParseInt(chi.URLParam(r, "teacherID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid teacher id")
			return
		}
		teacher, ok := teacherInCenter(w, r, q, teacherID, centerID)
		if !ok {
			return
		}
		if !guardLastHead(r.Context(), w, r, q, centerID, teacher) {
			return
		}
		if _, err := q.RemoveTeacher(r.Context(), teacherID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: remove teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove teacher")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Students -------------------------------------------------------------------

type manageAddStudentRequest struct {
	UserID  int64 `json:"user_id"`
	GroupID int64 `json:"group_id"`
}

type manageSetGroupRequest struct {
	GroupID int64 `json:"group_id"`
}

func manageListStudents(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		students, err := q.ListStudentsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list students", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list students")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, students)
	}
}

// manageAddStudent enrolls an existing user into a group of {centerID}. Mirrors
// admin.AddStudent, plus a guard that the target group belongs to this center.
func manageAddStudent(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		centerID, _, ok := manageGate(w, r, store.New(database.Pool()))
		if !ok {
			return
		}
		var req manageAddStudentRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 || req.GroupID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id and group_id required")
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(ctx, "manage: begin add-student tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		group, err := q.GetGroup(ctx, req.GroupID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
				return
			}
			logger.LogErrorContext(ctx, "manage: get group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if group.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return
		}

		isTeacher, err := q.IsTeacherInCenter(ctx, store.IsTeacherInCenterParams{
			UserID: req.UserID, MathCenterID: centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "manage: add-student teacher check", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if isTeacher {
			httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is a teacher of this center and cannot also be a student there")
			return
		}

		s, err := q.AddStudentToGroup(ctx, store.AddStudentToGroupParams{
			UserID: req.UserID, GroupID: req.GroupID,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a student in some group")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user does not exist")
				return
			}
			logger.LogErrorContext(ctx, "manage: add student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(ctx, "manage: commit add-student tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		httpx.WriteJSON(w, http.StatusCreated, s)
	}
}

// manageSetStudentGroup moves a student to another group within the SAME center.
func manageSetStudentGroup(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		var req manageSetGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.GroupID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "group_id required")
			return
		}
		// The student must currently belong to this center, and the target group
		// must too — so a move can never relocate a student across centers.
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		if !groupInCenter(w, r, q, req.GroupID, centerID) {
			return
		}
		if _, err := q.SetStudentGroup(r.Context(), store.SetStudentGroupParams{
			ID: studentID, GroupID: req.GroupID,
		}); err != nil {
			logger.LogErrorContext(r.Context(), "manage: set student group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to move student")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

func manageRemoveStudent(database *db.DB, hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		studentID, err := strconv.ParseInt(chi.URLParam(r, "studentID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
			return
		}
		if !studentInCenter(w, r, q, studentID, centerID) {
			return
		}
		if _, err := q.RemoveStudent(r.Context(), studentID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: remove student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove student")
			return
		}
		live.Publish(r.Context(), database.Pool(), live.Event{CenterID: centerID, Kind: live.KindMembership})
		w.WriteHeader(http.StatusNoContent)
	}
}

// User search ----------------------------------------------------------------

func manageUserSearch(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		if _, _, ok := manageGate(w, r, q); !ok {
			return
		}
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if len(query) < 2 {
			httpx.WriteJSON(w, http.StatusOK, []store.SearchUsersRow{})
			return
		}
		rows, err := q.SearchUsers(r.Context(), query)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: user search", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to search users")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rows)
	}
}

// Invites --------------------------------------------------------------------

type manageInviteView struct {
	ID          int64     `json:"id"`
	Token       string    `json:"token"`
	Description string    `json:"description"`
	MaxUses     int32     `json:"max_uses"`
	Uses        int64     `json:"uses"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
	Role        string    `json:"role"`
	GroupID     *int64    `json:"group_id,omitempty"`
	IsHead      bool      `json:"is_head_teacher"`
}

type manageCreateInviteRequest struct {
	Role           string `json:"role"`
	GroupID        int64  `json:"group_id"`
	IsHeadTeacher  bool   `json:"is_head_teacher"`
	Description    string `json:"description"`
	MaxUses        int32  `json:"max_uses"`
	ExpiresInHours int    `json:"expires_in_hours"`
}

func manageListInvites(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		tokens, err := q.ListInvitationTokensForCenter(r.Context(), &centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: list invites", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list invites")
			return
		}
		out := make([]manageInviteView, 0, len(tokens))
		for _, t := range tokens {
			uses, err := q.CountUsesOfInvitationToken(r.Context(), t.ID)
			if err != nil {
				logger.LogErrorContext(r.Context(), "manage: count invite uses", err, "token_id", t.ID)
				uses = 0
			}
			view := manageInviteView{
				ID: t.ID, Token: t.Token, Description: t.Description,
				MaxUses: t.MaxUses, Uses: uses, ExpiresAt: t.ExpiresAt, CreatedAt: t.CreatedAt,
			}
			if preset, err := tokenpreset.Parse(t.Preset); err == nil {
				switch {
				case preset.MathCenterTeacher != nil:
					view.Role = "teacher"
					view.IsHead = preset.MathCenterTeacher.IsHeadTeacher
				case preset.MathCenterStudent != nil:
					view.Role = "student"
					gid := preset.MathCenterStudent.GroupID
					view.GroupID = &gid
				}
			}
			out = append(out, view)
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// manageCreateInvite mints a center-scoped invitation token. The preset is built
// SERVER-SIDE from role+group — the client never supplies a raw preset — so a
// head teacher cannot grant admin or bind the token to another center.
func manageCreateInvite(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		var req manageCreateInviteRequest
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

		var preset tokenpreset.Preset
		switch req.Role {
		case "teacher":
			preset.MathCenterTeacher = &tokenpreset.MathCenterTeacher{
				CenterID: centerID, IsHeadTeacher: req.IsHeadTeacher,
			}
		case "student":
			if !groupInCenter(w, r, q, req.GroupID, centerID) {
				return
			}
			preset.MathCenterStudent = &tokenpreset.MathCenterStudent{GroupID: req.GroupID}
		default:
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "role must be teacher or student")
			return
		}

		if err := tokenpreset.Validate(r.Context(), q, preset); err != nil {
			if errors.Is(err, tokenpreset.ErrInvalidPreset) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
				return
			}
			logger.LogErrorContext(r.Context(), "manage: validate invite preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}
		presetJSON, err := tokenpreset.Marshal(preset)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: marshal invite preset", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}
		raw, err := randomHexToken(32)
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: random token", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}

		tok, err := q.CreateInvitationToken(r.Context(), store.CreateInvitationTokenParams{
			Token:        raw,
			Description:  req.Description,
			MaxUses:      req.MaxUses,
			ExpiresAt:    time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour),
			Preset:       presetJSON,
			MathCenterID: &centerID,
		})
		if err != nil {
			logger.LogErrorContext(r.Context(), "manage: create invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create invite")
			return
		}

		view := manageInviteView{
			ID: tok.ID, Token: tok.Token, Description: tok.Description,
			MaxUses: tok.MaxUses, Uses: 0, ExpiresAt: tok.ExpiresAt, CreatedAt: tok.CreatedAt,
			Role: req.Role, IsHead: req.IsHeadTeacher,
		}
		if req.Role == "student" {
			gid := req.GroupID
			view.GroupID = &gid
		}
		httpx.WriteJSON(w, http.StatusCreated, view)
	}
}

func manageRevokeInvite(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := store.New(database.Pool())
		centerID, _, ok := manageGate(w, r, q)
		if !ok {
			return
		}
		tokenID, err := strconv.ParseInt(chi.URLParam(r, "tokenID"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid token id")
			return
		}
		tok, err := q.GetInvitationTokenByID(r.Context(), tokenID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "invite not found")
				return
			}
			logger.LogErrorContext(r.Context(), "manage: get invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if tok.MathCenterID == nil || *tok.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "invite not found")
			return
		}
		if _, err := q.RevokeInvitationTokenByID(r.Context(), tokenID); err != nil {
			logger.LogErrorContext(r.Context(), "manage: revoke invite", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to revoke invite")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// helpers --------------------------------------------------------------------

// groupInCenter loads a group and confirms it belongs to {centerID}. On any
// mismatch it writes 404 and returns false. Foreign groups are reported as "not
// found" rather than "forbidden" so a head teacher cannot probe other centers.
func groupInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, groupID, centerID int64) bool {
	group, err := q.GetGroup(r.Context(), groupID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return false
		}
		logger.LogErrorContext(r.Context(), "manage: get group", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if group.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
		return false
	}
	return true
}

func teacherInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, teacherID, centerID int64) (store.MathCenterTeacher, bool) {
	teacher, err := q.GetTeacher(r.Context(), teacherID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
			return store.MathCenterTeacher{}, false
		}
		logger.LogErrorContext(r.Context(), "manage: get teacher", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return store.MathCenterTeacher{}, false
	}
	if teacher.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
		return store.MathCenterTeacher{}, false
	}
	return teacher, true
}

// studentInCenter confirms the student row belongs to {centerID} by resolving
// its group's center.
func studentInCenter(w http.ResponseWriter, r *http.Request, q *store.Queries, studentID, centerID int64) bool {
	student, err := q.GetStudent(r.Context(), studentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found")
			return false
		}
		logger.LogErrorContext(r.Context(), "manage: get student", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	return groupInCenter(w, r, q, student.GroupID, centerID)
}

// guardLastHead returns false (and writes 409) if removing/demoting {teacher}
// would leave the center with zero head teachers.
func guardLastHead(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, centerID int64, teacher store.MathCenterTeacher) bool {
	if !teacher.IsHeadTeacher {
		return true
	}
	n, err := q.CountHeadTeachersForCenter(ctx, centerID)
	if err != nil {
		logger.LogErrorContext(ctx, "manage: count heads", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if n <= 1 {
		httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "cannot remove the last head teacher")
		return false
	}
	return true
}

func isFKViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// randomHexToken returns 2*n hex chars of cryptographically random data, the
// same shape as the admin token generator.
func randomHexToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
