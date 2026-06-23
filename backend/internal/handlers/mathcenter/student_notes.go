package mathcenter

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	hw "github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	mc "github.com/Alarion239/my239/backend/internal/mathcenter"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// studentProfileView anchors the teacher-facing student page: identity + the
// student's group, enough for the profile header that hosts the notes panel.
type studentProfileView struct {
	UserID         int64   `json:"user_id"`
	FirstName      string  `json:"first_name"`
	MiddleName     *string `json:"middle_name"`
	LastName       string  `json:"last_name"`
	DisplayName    string  `json:"display_name"`
	GroupID        int64   `json:"group_id"`
	GroupName      string  `json:"group_name"`
	GraduationYear int     `json:"graduation_year"`
}

// studentNoteView is the wire shape for one internal note on a student.
type studentNoteView struct {
	ID           int64     `json:"id"`
	AuthorUserID int64     `json:"author_user_id"`
	AuthorName   string    `json:"author_name"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type studentNoteBodyRequest struct {
	Body string `json:"body"`
}

// validateStudentNoteBody trims + length-checks a note body, rejecting empty.
func validateStudentNoteBody(raw string) (string, string) {
	body, err := hw.ValidateBody(raw)
	if err != nil {
		return "", err.Error()
	}
	if body == "" {
		return "", "comment body is required"
	}
	return body, ""
}

// GetStudentProfile — teacher of the center. Returns a student's identity and
// group; 404 if the user isn't a student of this center.
func GetStudentProfile(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		_ = userID
		q := store.New(database.Pool())
		student, err := q.GetStudentByUserID(ctx, studentUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found")
				return
			}
			logger.LogErrorContext(ctx, "mathcenter: get student profile", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		if student.MathCenterID != centerID {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found in this center")
			return
		}
		u, err := q.GetUserByID(ctx, studentUserID)
		if err != nil {
			logger.LogErrorContext(ctx, "mathcenter: get student user", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, studentProfileView{
			UserID:         u.ID,
			FirstName:      u.FirstName,
			MiddleName:     u.MiddleName,
			LastName:       u.LastName,
			DisplayName:    mc.StudentDisplayName(u.FirstName, u.LastName),
			GroupID:        student.GroupID,
			GroupName:      student.GroupName,
			GraduationYear: int(student.GraduationYear),
		})
	}
}

// ListStudentNotes — teacher of the center. Returns the student's internal
// notes, oldest first.
func ListStudentNotes(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		_, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		q := store.New(database.Pool())
		rows, err := q.ListStudentNotesAuthored(ctx, store.ListStudentNotesAuthoredParams{
			StudentUserID: studentUserID,
			MathCenterID:  centerID,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "mathcenter: list student notes", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		out := make([]studentNoteView, 0, len(rows))
		for _, n := range rows {
			out = append(out, studentNoteView{
				ID:           n.ID,
				AuthorUserID: n.AuthorUserID,
				AuthorName:   mc.StudentDisplayName(n.AuthorFirstName, n.AuthorLastName),
				Body:         n.Body,
				CreatedAt:    n.CreatedAt,
				UpdatedAt:    n.UpdatedAt,
			})
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// CreateStudentNote — teacher of the center appends a note to a student.
func CreateStudentNote(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		var req studentNoteBodyRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		body, vErr := validateStudentNoteBody(req.Body)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}
		q := store.New(database.Pool())
		note, err := q.CreateStudentNote(ctx, store.CreateStudentNoteParams{
			StudentUserID: studentUserID,
			MathCenterID:  centerID,
			AuthorUserID:  userID,
			Body:          body,
		})
		if err != nil {
			logger.LogErrorContext(ctx, "mathcenter: create student note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save comment")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindComments})
		writeStudentNoteView(ctx, w, r, q, note.ID, http.StatusCreated)
	}
}

// UpdateStudentNote — the note's author (or an admin) edits its body.
func UpdateStudentNote(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		noteID, err := pathInt64(r, "noteID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid note id")
			return
		}
		var req studentNoteBodyRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		body, vErr := validateStudentNoteBody(req.Body)
		if vErr != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, vErr)
			return
		}
		q := store.New(database.Pool())
		if !authorizeStudentNoteWrite(ctx, w, r, q, userID, centerID, studentUserID, noteID) {
			return
		}
		affected, err := q.UpdateStudentNote(ctx, store.UpdateStudentNoteParams{ID: noteID, Body: body})
		if err != nil {
			logger.LogErrorContext(ctx, "mathcenter: update student note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to update comment")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindComments})
		writeStudentNoteView(ctx, w, r, q, noteID, http.StatusOK)
	}
}

// DeleteStudentNote — the note's author (or an admin) deletes it.
func DeleteStudentNote(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		noteID, err := pathInt64(r, "noteID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid note id")
			return
		}
		q := store.New(database.Pool())
		if !authorizeStudentNoteWrite(ctx, w, r, q, userID, centerID, studentUserID, noteID) {
			return
		}
		affected, err := q.DeleteStudentNote(ctx, noteID)
		if err != nil {
			logger.LogErrorContext(ctx, "mathcenter: delete student note", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to delete comment")
			return
		}
		if affected == 0 {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return
		}
		live.Publish(ctx, database.Pool(), live.Event{CenterID: centerID, Kind: live.KindComments})
		w.WriteHeader(http.StatusNoContent)
	}
}

// studentNotePathAuthz parses {centerID}/{studentUserID}, enforces the caller
// teaches the center, and that the target is a student of it. Returns the
// caller, center, and student ids.
func studentNotePathAuthz(ctx context.Context, w http.ResponseWriter, r *http.Request, database *db.DB) (userID, centerID, studentUserID int64, ok bool) {
	userID, ok = requireUser(w, r)
	if !ok {
		return 0, 0, 0, false
	}
	centerID, err := pathInt64(r, "centerID")
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
		return 0, 0, 0, false
	}
	studentUserID, err = pathInt64(r, "studentUserID")
	if err != nil {
		httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid student id")
		return 0, 0, 0, false
	}
	q := store.New(database.Pool())
	if !requireTeacher(ctx, w, r, q, userID, centerID) {
		return 0, 0, 0, false
	}
	isStudent, err := q.IsStudentInCenter(ctx, store.IsStudentInCenterParams{
		UserID: studentUserID, MathCenterID: centerID,
	})
	if err != nil {
		logger.LogErrorContext(ctx, "mathcenter: student-in-center check", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return 0, 0, 0, false
	}
	if !isStudent {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "student not found in this center")
		return 0, 0, 0, false
	}
	return userID, centerID, studentUserID, true
}

// authorizeStudentNoteWrite loads the note and enforces: it belongs to this
// (student, center), and the caller is its author (or an admin).
func authorizeStudentNoteWrite(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, userID, centerID, studentUserID, noteID int64) bool {
	note, err := q.GetStudentNote(ctx, noteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
			return false
		}
		logger.LogErrorContext(ctx, "mathcenter: get student note", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return false
	}
	if note.StudentUserID != studentUserID || note.MathCenterID != centerID {
		httpx.WriteAPIError(w, r, http.StatusNotFound, httpx.CodeNotFound, "comment not found")
		return false
	}
	if !callerIsAdmin(r) && note.AuthorUserID != userID {
		httpx.WriteAPIError(w, r, http.StatusForbidden, httpx.CodeForbidden, "only the comment's author can edit or delete it")
		return false
	}
	return true
}

// writeStudentNoteView fetches the authored view of one note and writes it.
func writeStudentNoteView(ctx context.Context, w http.ResponseWriter, r *http.Request, q *store.Queries, noteID int64, status int) {
	n, err := q.GetStudentNoteAuthored(ctx, noteID)
	if err != nil {
		logger.LogErrorContext(ctx, "mathcenter: get student note view", err)
		httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
		return
	}
	httpx.WriteJSON(w, status, studentNoteView{
		ID:           n.ID,
		AuthorUserID: n.AuthorUserID,
		AuthorName:   mc.StudentDisplayName(n.AuthorFirstName, n.AuthorLastName),
		Body:         n.Body,
		CreatedAt:    n.CreatedAt,
		UpdatedAt:    n.UpdatedAt,
	})
}
