package mathcenter

import (
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/internal/store"
)

// A subproblem's разбор becomes visible to students per the per-subproblem rule:
// a normal subproblem at the series deadline (even if uploaded early); a coffin
// only once it is released (released_at set and past). Teachers are never gated
// by this helper (callers check isTeacher separately).
func TestSolutionReleasedToStudent(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	cases := []struct {
		name       string
		isCoffin   bool
		releasedAt *time.Time
		dueAt      time.Time
		want       bool
	}{
		{"normal, before deadline -> hidden", false, nil, future, false},
		{"normal, after deadline -> visible", false, nil, past, true},
		{"normal, exactly at deadline -> visible", false, nil, now, true},
		{"coffin, not released -> hidden even past due", true, nil, past, false},
		{"coffin, released in future -> hidden", true, &future, past, false},
		{"coffin, released in past -> visible", true, &past, future, true},
		{"coffin, released exactly now -> visible", true, &now, future, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := store.MathCenterSubproblemSolution{IsCoffin: tc.isCoffin, ReleasedAt: tc.releasedAt}
			if got := solutionReleasedToStudent(s, tc.dueAt, now); got != tc.want {
				t.Errorf("solutionReleasedToStudent = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSubproblemSolutionPDFKey(t *testing.T) {
	t.Parallel()
	if got := subproblemSolutionPDFKey(42); got != "mathcenter/subproblem/42.solution.pdf" {
		t.Errorf("subproblemSolutionPDFKey(42) = %q", got)
	}
}
