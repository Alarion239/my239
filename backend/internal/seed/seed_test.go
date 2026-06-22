package seed

import "testing"

func TestLabelsFor(t *testing.T) {
	t.Parallel()
	cases := []struct {
		count int
		want  []string
	}{
		{0, []string{""}}, // single unlabelled part (sentinel)
		{1, []string{"a"}},
		{3, []string{"a", "b", "c"}},
	}
	for _, tc := range cases {
		got := labelsFor(tc.count)
		if len(got) != len(tc.want) {
			t.Fatalf("labelsFor(%d) = %v, want %v", tc.count, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("labelsFor(%d)[%d] = %q, want %q", tc.count, i, got[i], tc.want[i])
			}
		}
	}
}

// Difficulty must rise (base solve rate must fall) as non-final problems get
// later, the final problem must be the hardest, and later subparts must be no
// easier than earlier ones.
func TestSolveBaseIsHarderLater(t *testing.T) {
	t.Parallel()

	const problemCount = 5

	// Non-final problems get strictly harder with position.
	prev := solveBase(problemCount, 0, 0)
	for pi := 1; pi < problemCount-1; pi++ {
		got := solveBase(problemCount, pi, 0)
		if got >= prev {
			t.Errorf("solveBase(pi=%d)=%.2f not harder than pi=%d (%.2f)", pi, got, pi-1, prev)
		}
		prev = got
	}

	// The final problem is the hardest of all (finale penalty).
	last := solveBase(problemCount, problemCount-1, 0)
	for pi := range problemCount - 1 {
		if last >= solveBase(problemCount, pi, 0) {
			t.Errorf("final problem base %.2f not below problem %d", last, pi)
		}
	}

	// Later subparts are no easier than earlier ones.
	if a, c := solveBase(problemCount, 1, 0), solveBase(problemCount, 1, 2); c >= a {
		t.Errorf("subpart c base %.2f not below subpart a %.2f", c, a)
	}

	// The hardest subproblems must reach a near-zero solve base so the cohort
	// leaves coffins; with a positive ability cap they shouldn't be unsolvable.
	if got := solveBase(problemCount, problemCount-1, 2); got > 0.1 {
		t.Errorf("hardest subproblem base %.2f too high to yield a coffin", got)
	}
}

func TestClampF(t *testing.T) {
	t.Parallel()
	cases := []struct{ v, lo, hi, want float64 }{
		{-0.5, 0, 1, 0},
		{1.5, 0, 1, 1},
		{0.4, 0, 1, 0.4},
	}
	for _, c := range cases {
		if got := clampF(c.v, c.lo, c.hi); got != c.want {
			t.Errorf("clampF(%v,%v,%v)=%v, want %v", c.v, c.lo, c.hi, got, c.want)
		}
	}
}

func TestNewEventUUIDUnique(t *testing.T) {
	t.Parallel()
	a, err := newEventUUID()
	if err != nil {
		t.Fatal(err)
	}
	b, err := newEventUUID()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("newEventUUID returned duplicate values")
	}
}
