package mathcenter

import (
	"fmt"
	"strings"
)

// MaxSubproblemsPerProblem caps how many letters a teacher can request when
// creating a problem. 26 is "the Latin alphabet"; we don't expect more than a
// handful in practice, but the cap stops a malformed request from creating
// pathological data.
const MaxSubproblemsPerProblem = 26

// SeriesDisplayName returns the canonical "Серия N. Name" string used
// everywhere a series is shown to users.
func SeriesDisplayName(number int, name string) string {
	return fmt.Sprintf("Серия %d. %s", number, strings.TrimSpace(name))
}

// ProblemDisplayName returns the user-facing label for a problem. number 0
// is reserved for the warm-up "Упражнение"; positive numbers render as
// "Задача N".
func ProblemDisplayName(number int) string {
	if number == 0 {
		return "Упражнение"
	}
	return fmt.Sprintf("Задача %d", number)
}

// SubproblemLabels returns the first `count` Latin lowercase labels: a, b, c,
// d, … Returns nil for count <= 0; clamps to MaxSubproblemsPerProblem.
func SubproblemLabels(count int) []string {
	if count <= 0 {
		return nil
	}
	if count > MaxSubproblemsPerProblem {
		count = MaxSubproblemsPerProblem
	}
	out := make([]string, count)
	for i := range count {
		out[i] = string(rune('a' + i))
	}
	return out
}
