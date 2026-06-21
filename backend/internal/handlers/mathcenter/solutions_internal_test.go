package mathcenter

import (
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/internal/store"
)

// The official разбор must only become visible to students once the series
// deadline has passed — even if the teacher uploaded it earlier. Uploading
// early simply means it "releases" at the deadline. Teachers are never gated by
// this helper (callers check isTeacher separately).
func TestSolutionVisibleToStudent(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	published := now.Add(-72 * time.Hour)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	cases := []struct {
		name        string
		publishedAt *time.Time
		dueAt       time.Time
		want        bool
	}{
		{"uploaded early but before deadline -> hidden", &published, future, false},
		{"after deadline -> visible", &published, past, true},
		{"exactly at deadline -> visible", &published, now, true},
		{"series not published -> hidden even past due", nil, past, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := store.MathCenterSeries{PublishedAt: tc.publishedAt, DueAt: tc.dueAt}
			if got := solutionVisibleToStudent(s, now); got != tc.want {
				t.Errorf("solutionVisibleToStudent = %v, want %v", got, tc.want)
			}
		})
	}
}
