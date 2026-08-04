package mathcenter

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/httpx"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

type studentNameColorRequest struct {
	BackgroundHex *string `json:"background_hex"`
}

type studentNameColorView struct {
	BackgroundHex *string `json:"background_hex"`
}

func normalizeStudentNameColor(raw *string) (*string, string) {
	if raw == nil {
		return nil, ""
	}
	value := strings.ToUpper(strings.TrimSpace(*raw))
	if len(value) != 7 || value[0] != '#' {
		return nil, "background_hex must be a six-digit HEX color"
	}
	for _, c := range value[1:] {
		if (c < '0' || c > '9') && (c < 'A' || c > 'F') {
			return nil, "background_hex must be a six-digit HEX color"
		}
	}
	return &value, ""
}

// UpdateStudentNameColor stores or clears the teacher-only background color
// for a student in this center.
func UpdateStudentNameColor(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		_, centerID, studentUserID, ok := studentNotePathAuthz(ctx, w, r, database)
		if !ok {
			return
		}
		var req studentNameColorRequest
		if !httpx.DecodeJSONBody(w, r, &req) {
			return
		}
		backgroundHex, validationError := normalizeStudentNameColor(req.BackgroundHex)
		if validationError != "" {
			httpx.WriteAPIError(w, r, http.StatusBadRequest, httpx.CodeBadRequest, validationError)
			return
		}

		q := store.New(database.Pool())
		if backgroundHex == nil {
			if _, err := q.ClearStudentNameColor(ctx, store.ClearStudentNameColorParams{
				MathCenterID: centerID, StudentUserID: studentUserID,
			}); err != nil {
				logger.LogErrorContext(ctx, "mathcenter: clear student name color", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save name color")
				return
			}
		} else {
			stored, err := q.UpsertStudentNameColor(ctx, store.UpsertStudentNameColorParams{
				MathCenterID: centerID, StudentUserID: studentUserID, BackgroundHex: *backgroundHex,
			})
			if err != nil {
				logger.LogErrorContext(ctx, "mathcenter: save student name color", err)
				httpx.WriteAPIError(w, r, http.StatusInternalServerError, httpx.CodeInternal, "failed to save name color")
				return
			}
			backgroundHex = &stored
		}

		live.Publish(ctx, database.Pool(), live.Event{
			CenterID: centerID, Kind: live.KindStudentNameColor, StudentUserID: studentUserID,
		})
		httpx.WriteJSON(w, http.StatusOK, studentNameColorView{BackgroundHex: backgroundHex})
	}
}

func studentNameColorForProfile(ctx context.Context, q *store.Queries, centerID, studentUserID int64) (*string, error) {
	value, err := q.GetStudentNameColor(ctx, store.GetStudentNameColorParams{
		MathCenterID: centerID, StudentUserID: studentUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// StudentNameColorsForCenter returns the teacher-only color map used by other
// Math Center teacher handlers while keeping the query seam in this package.
func StudentNameColorsForCenter(ctx context.Context, q *store.Queries, centerID int64) (map[int64]string, error) {
	rows, err := q.ListStudentNameColorsForCenter(ctx, centerID)
	if err != nil {
		return nil, err
	}
	colors := make(map[int64]string, len(rows))
	for _, row := range rows {
		colors[row.StudentUserID] = row.BackgroundHex
	}
	return colors, nil
}
