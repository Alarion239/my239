package admin

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/ctxcache"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// ListUsers returns every user in the system.
func ListUsers(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		users, err := store.New(database.Pool()).ListUsers(r.Context())
		if err != nil {
			logger.LogErrorContext(r.Context(), "admin: list users", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to list users")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, users)
	}
}

// GetUser returns a single user by id, so the admin UI can open a user and
// manage their roles. password_hash never serializes (json:"-" on the model).
func GetUser(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid user id")
			return
		}

		user, err := store.New(database.Pool()).GetUserByID(r.Context(), id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "user not found")
				return
			}
			logger.LogErrorContext(r.Context(), "admin: get user", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to get user")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, user)
	}
}

type setAdminRequest struct {
	IsAdmin bool `json:"is_admin"`
}

// SetUserAdmin promotes / demotes a user. We refuse to let an admin demote
// themselves: if a single admin in the system did that, no one would be left
// to manage the platform. Promotion of a different admin is fine.
func SetUserAdmin(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid user id")
			return
		}

		var req setAdminRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}

		callerID, err := ctxcache.UserID(r.Context())
		if err == nil && callerID == id && !req.IsAdmin {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "cannot demote yourself")
			return
		}

		q := store.New(database.Pool())
		if err := q.SetUserAdmin(r.Context(), store.SetUserAdminParams{ID: id, IsAdmin: req.IsAdmin}); err != nil {
			logger.LogErrorContext(r.Context(), "admin: set user admin", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update user")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// teacherEnrollment is one center the user teaches. teacher_id is the
// math_center_teachers row id, which the admin UI passes to
// DELETE /admin/mathcenter/teachers/{teacherId} to remove the enrollment.
type teacherEnrollment struct {
	TeacherID      int64 `json:"teacher_id"`
	CenterID       int64 `json:"center_id"`
	GraduationYear int   `json:"graduation_year"`
	Grade          int   `json:"grade"`
	IsHeadTeacher  bool  `json:"is_head_teacher"`
}

// studentEnrollment is the single center the user studies at, or null when not
// enrolled. student_id is the math_center_students row id, passed to
// DELETE /admin/mathcenter/students/{studentId} to remove the enrollment.
type studentEnrollment struct {
	StudentID      int64  `json:"student_id"`
	CenterID       int64  `json:"center_id"`
	GroupID        int64  `json:"group_id"`
	GroupName      string `json:"group_name"`
	GraduationYear int    `json:"graduation_year"`
	Grade          int    `json:"grade"`
}

// userEnrollmentsResponse is the admin view of a user's math-center
// memberships, carrying the row ids needed to remove each one. Student is null
// when the user studies nowhere; teaching is always present (possibly empty).
type userEnrollmentsResponse struct {
	Teaching []teacherEnrollment `json:"teaching"`
	Student  *studentEnrollment  `json:"student"`
}

// GetUserEnrollments returns the user's current math-center memberships with
// the row ids the admin UI needs to remove them. Grade is computed per center
// from graduation_year the same way mathcenter.Me does.
func GetUserEnrollments(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid user id")
			return
		}

		ctx := r.Context()
		q := store.New(database.Pool())
		now := time.Now()

		teacherRows, err := q.ListTeacherEnrollmentsForUser(ctx, id)
		if err != nil {
			logger.LogErrorContext(ctx, "admin: list teacher enrollments", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load enrollments")
			return
		}
		teaching := make([]teacherEnrollment, 0, len(teacherRows))
		for _, t := range teacherRows {
			teaching = append(teaching, teacherEnrollment{
				TeacherID:      t.TeacherID,
				CenterID:       t.CenterID,
				GraduationYear: int(t.GraduationYear),
				Grade:          mc.Grade(int(t.GraduationYear), now),
				IsHeadTeacher:  t.IsHeadTeacher,
			})
		}

		var student *studentEnrollment
		row, err := q.GetStudentByUserID(ctx, id)
		switch {
		case err == nil:
			student = &studentEnrollment{
				StudentID:      row.ID,
				CenterID:       row.MathCenterID,
				GroupID:        row.GroupID,
				GroupName:      row.GroupName,
				GraduationYear: int(row.GraduationYear),
				Grade:          mc.Grade(int(row.GraduationYear), now),
			}
		case errors.Is(err, pgx.ErrNoRows):
			// Not enrolled as a student: leave student nil -> null in JSON.
		default:
			logger.LogErrorContext(ctx, "admin: get student enrollment", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to load enrollments")
			return
		}

		httpx.WriteJSON(w, http.StatusOK, userEnrollmentsResponse{
			Teaching: teaching,
			Student:  student,
		})
	}
}
