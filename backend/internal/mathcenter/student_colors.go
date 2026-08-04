package mathcenter

import (
	"context"

	"github.com/Alarion239/my239/backend/internal/store"
)

// StudentNameColorsForCenter returns teacher-only name colors for one center.
// Callers already enforce teacher authorization before requesting this map.
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
