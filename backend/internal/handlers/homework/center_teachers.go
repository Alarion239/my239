package homework

import (
	"net/http"

	"github.com/Alarion239/my239/backend/internal/homework"
	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// centerTeacher is one option for the offline-grading initials autocomplete:
// a registered teacher of the center with their full name and initials.
type centerTeacher struct {
	UserID   int64  `json:"user_id"`
	Name     string `json:"name"`
	Initials string `json:"initials"`
}

// CenterTeachers — teacher of the center. Lists the center's teachers so the
// «кондуит» can resolve typed initials to a registered grader. Distinct from
// the head-teacher-only manage listing: any teacher at the shared computer
// needs this to credit a colleague.
func CenterTeachers(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID, ok := requireUser(w, r)
		if !ok {
			return
		}
		centerID, err := pathInt64(r, "centerID")
		if err != nil {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, "invalid center id")
			return
		}

		q := store.New(database.Pool())
		if !requireTeacher(ctx, w, r, q, userID, centerID) {
			return
		}

		rows, err := q.ListTeachersForCenter(ctx, centerID)
		if err != nil {
			logger.LogErrorContext(ctx, "homework: list center teachers", err)
			httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "internal error")
			return
		}
		out := make([]centerTeacher, 0, len(rows))
		for _, t := range rows {
			out = append(out, centerTeacher{
				UserID:   t.UserID,
				Name:     homework.FullName(t.FirstName, t.LastName),
				Initials: initials(&t.FirstName, &t.LastName),
			})
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"teachers": out})
	}
}
