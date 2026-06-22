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

// Difficulty must rise (solver count must fall) as problems and subparts get
// later, and stay within [0, cohort]. This is what produces coffins on the
// hardest subproblems.
func TestAcceptedTargetIsHarderLater(t *testing.T) {
	t.Parallel()

	// Later problems are solved by no more students than earlier ones.
	prev := acceptedTarget(0, 0)
	for pi := 1; pi < 8; pi++ {
		got := acceptedTarget(pi, 0)
		if got > prev {
			t.Errorf("acceptedTarget(%d,0)=%d > acceptedTarget(%d,0)=%d: should not increase", pi, got, pi-1, prev)
		}
		prev = got
	}

	// Later subparts within a problem are no easier than earlier ones.
	if a, b := acceptedTarget(2, 0), acceptedTarget(2, 2); b > a {
		t.Errorf("subpart c (%d) easier than subpart a (%d)", b, a)
	}

	// Bounds: never negative, never above the cohort.
	for pi := range 12 {
		for spi := range 4 {
			got := acceptedTarget(pi, spi)
			if got < 0 || got > demoStudents {
				t.Errorf("acceptedTarget(%d,%d)=%d out of [0,%d]", pi, spi, got, demoStudents)
			}
		}
	}

	// The gradient must actually reach the coffin band somewhere in the range,
	// or the demo would never produce a coffin.
	if acceptedTarget(7, 2) >= coffinThreshold {
		t.Errorf("hardest subproblem solved by %d students, want < %d (a coffin)",
			acceptedTarget(7, 2), coffinThreshold)
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
