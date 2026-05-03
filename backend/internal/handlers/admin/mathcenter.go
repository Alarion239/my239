package admin

import (
	"errors"
	"net/http"
	"strconv"

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
			logger.LogError("admin/mc: list centers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list centers")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, centers)
	}
}

func CreateMathCenter(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCenterRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
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
			logger.LogError("admin/mc: create center", err)
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
			logger.LogError("admin/mc: delete center", err)
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
			logger.LogError("admin/mc: list groups", err)
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
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
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
			logger.LogError("admin/mc: create group", err)
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
			logger.LogError("admin/mc: delete group", err)
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
			logger.LogError("admin/mc: list students", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list students")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, students)
	}
}

func AddStudent(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req addStudentRequest
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
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
			logger.LogError("admin/mc: add student", err)
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
			logger.LogError("admin/mc: remove student", err)
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
			logger.LogError("admin/mc: list teachers", err)
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
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
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
			logger.LogError("admin/mc: add teacher", err)
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
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
			return
		}
		n, err := store.New(database.Pool()).SetTeacherHead(r.Context(), store.SetTeacherHeadParams{
			ID:            id,
			IsHeadTeacher: req.IsHeadTeacher,
		})
		if err != nil {
			logger.LogError("admin/mc: set head", err)
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
			logger.LogError("admin/mc: remove teacher", err)
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
