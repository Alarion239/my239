package homework

import (
	"testing"
	"time"
)

func TestSubmissionClosed(t *testing.T) {
	t.Parallel()
	now := time.Date(2030, 6, 1, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	cases := []struct {
		name       string
		isCoffin   bool
		released   *time.Time
		due        time.Time
		wantClosed bool
	}{
		{"normal before due — open", false, nil, future, false},
		{"normal after due — closed", false, nil, past, true},
		{"coffin no release — open past due", true, nil, past, false},
		{"coffin released in past — closed", true, &past, past, true},
		{"coffin release in future — still open", true, &future, past, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := SubmissionClosed(c.isCoffin, c.released, c.due, now); got != c.wantClosed {
				t.Errorf("SubmissionClosed = %v, want %v", got, c.wantClosed)
			}
		})
	}
}
