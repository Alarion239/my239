package admin

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/Alarion239/my239/backend/internal/auth"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Centers --------------------------------------------------------------------

type createCenterRequest struct {
	GraduationYear int32 `json:"graduation_year"`
}

func ListMathCenters(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centers, err := store.New(database.Pool()).ListMathCenters(r.Context())
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: list centers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list centers")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, centers)
	}
}

func CreateMathCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCenterRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.GraduationYear < 1900 || req.GraduationYear > 2100 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "graduation_year out of range")
			return
		}

		center, err := store.New(database.Pool()).CreateMathCenter(r.Context(), req.GraduationYear)
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "math center for that graduation year already exists")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: create center", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create center")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, center)
	}
}

func DeleteMathCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		n, err := store.New(database.Pool()).DeleteMathCenter(r.Context(), id)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: delete center", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete center")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "center not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Groups ---------------------------------------------------------------------

type createGroupRequest struct {
	Name string `json:"name"`
}

func ListGroupsForCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		groups, err := store.New(database.Pool()).ListGroupsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: list groups", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list groups")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, groups)
	}
}

func CreateGroup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		var req createGroupRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || len(req.Name) > 50 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "name must be 1–50 chars")
			return
		}

		group, err := store.New(database.Pool()).CreateMathCenterGroup(r.Context(), store.CreateMathCenterGroupParams{
			MathCenterID: centerID,
			Name:         req.Name,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "group with that name already exists in this center")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: create group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create group")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, group)
	}
}

func DeleteGroup(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := pathInt64(r, "groupId")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		n, err := store.New(database.Pool()).DeleteMathCenterGroup(r.Context(), id)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: delete group", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete group")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "group not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Students -------------------------------------------------------------------

type addStudentRequest struct {
	UserID  int64 `json:"user_id"`
	GroupID int64 `json:"group_id"`
}

func ListStudentsForCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		students, err := store.New(database.Pool()).ListStudentsForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: list students", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list students")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, students)
	}
}

func AddStudent(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req addStudentRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 || req.GroupID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id and group_id required")
			return
		}

		s, err := store.New(database.Pool()).AddStudentToGroup(r.Context(), store.AddStudentToGroupParams{
			UserID:  req.UserID,
			GroupID: req.GroupID,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a student in some group")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user or group does not exist")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: add student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add student")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, s)
	}
}

func RemoveStudent(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := pathInt64(r, "studentId")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		n, err := store.New(database.Pool()).RemoveStudent(r.Context(), id)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: remove student", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove student")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Teachers -------------------------------------------------------------------

type addTeacherRequest struct {
	UserID        int64 `json:"user_id"`
	IsHeadTeacher bool  `json:"is_head_teacher"`
}

type setHeadRequest struct {
	IsHeadTeacher bool `json:"is_head_teacher"`
}

func ListTeachersForCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		teachers, err := store.New(database.Pool()).ListTeachersForCenter(r.Context(), centerID)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: list teachers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list teachers")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, teachers)
	}
}

func AddTeacher(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		var req addTeacherRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == 0 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user_id required")
			return
		}

		t, err := store.New(database.Pool()).AddTeacherToCenter(r.Context(), store.AddTeacherToCenterParams{
			UserID:        req.UserID,
			MathCenterID:  centerID,
			IsHeadTeacher: req.IsHeadTeacher,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "user is already a teacher of this center")
				return
			}
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "user or center does not exist")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: add teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to add teacher")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, t)
	}
}

func SetTeacherHead(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := pathInt64(r, "teacherId")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		var req setHeadRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		n, err := store.New(database.Pool()).SetTeacherHead(r.Context(), store.SetTeacherHeadParams{
			ID:            id,
			IsHeadTeacher: req.IsHeadTeacher,
		})
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: set head", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update teacher")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func RemoveTeacher(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := pathInt64(r, "teacherId")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}
		n, err := store.New(database.Pool()).RemoveTeacher(r.Context(), id)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: remove teacher", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to remove teacher")
			return
		}
		if n == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "teacher not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// MathCenter accounts --------------------------------------------------------

type createMathCenterAccountRequest struct {
	Username   string  `json:"username"`
	Password   string  `json:"password"`
	FirstName  string  `json:"first_name"`
	MiddleName *string `json:"middle_name"`
	LastName   string  `json:"last_name"`
}

// CreateMathCenterAccount provisions a shared "MathCenter" login for a single
// center: a classroom computer signs in with it to monitor progress and run
// general control during a session. Functionally the account is a head teacher
// of {id} — its rights come from the math_center_teachers row created here —
// and it is flagged is_math_center so the UI can tell it apart from a personal
// teacher account. The user row and the head-teacher enrollment are created in
// one transaction so a half-provisioned account can never linger.
func CreateMathCenterAccount(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		centerID, err := pathInt64(r, "id")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id")
			return
		}

		var req createMathCenterAccountRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		if len(req.Username) < 3 || len(req.Username) > 50 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "username must be 3–50 chars")
			return
		}
		if len(req.Password) < 8 || len(req.Password) > 128 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "password must be 8–128 chars")
			return
		}
		if req.FirstName == "" || len(req.FirstName) > 255 {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "first_name must be 1–255 chars")
			return
		}

		passwordHash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}

		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: begin account tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		q := store.New(tx)

		user, err := q.CreateMathCenterAccount(ctx, store.CreateMathCenterAccountParams{
			Username:     req.Username,
			PasswordHash: passwordHash,
			FirstName:    req.FirstName,
			MiddleName:   req.MiddleName,
			LastName:     req.LastName,
		})
		if err != nil {
			if isUniqueViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusConflict, httpx.CodeConflict, "username already taken")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: create account", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create account")
			return
		}

		if _, err := q.AddTeacherToCenter(ctx, store.AddTeacherToCenterParams{
			UserID:        user.ID,
			MathCenterID:  centerID,
			IsHeadTeacher: true,
		}); err != nil {
			if isFKViolation(err) {
				httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "center does not exist")
				return
			}
			logger.LogErrorContext(r.Context(), "admin/mc: enroll account", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to create account")
			return
		}

		if err := tx.Commit(ctx); err != nil {
			logger.LogErrorContext(r.Context(), "admin/mc: commit account tx", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}

		httpx.WriteJSON(w, http.StatusCreated, user)
	}
}

// helpers --------------------------------------------------------------------

func pathInt64(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, key), 10, 64)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23505"
}

func isFKViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23503"
}
