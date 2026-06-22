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

// The demo is only useful if it exercises every homework status, so the cycle
// must contain each one (including the untouched no-thread case).
func TestStateCycleCoversEveryStatus(t *testing.T) {
	t.Parallel()
	seen := map[subState]bool{}
	for _, st := range stateCycle {
		seen[st] = true
	}
	for _, want := range []subState{stUntouched, stSubmitted, stUnderReview, stAccepted, stRejected, stAppealed} {
		if !seen[want] {
			t.Errorf("stateCycle missing status %d", want)
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
