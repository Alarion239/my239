package mathcenter

import (
	"reflect"
	"testing"
)

func TestSeriesDisplayName(t *testing.T) {
	cases := []struct {
		number int
		name   string
		want   string
	}{
		{1, "Алгебра", "Серия 1. Алгебра"},
		{12, "  Геометрия ", "Серия 12. Геометрия"},
		{0, "Разминка", "Серия 0. Разминка"},
	}
	for _, c := range cases {
		if got := SeriesDisplayName(c.number, c.name); got != c.want {
			t.Errorf("SeriesDisplayName(%d, %q) = %q, want %q", c.number, c.name, got, c.want)
		}
	}
}

func TestProblemDisplayName(t *testing.T) {
	cases := map[int]string{
		0: "Упражнение",
		1: "Задача 1",
		7: "Задача 7",
	}
	for n, want := range cases {
		if got := ProblemDisplayName(n); got != want {
			t.Errorf("ProblemDisplayName(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestSubproblemLabels(t *testing.T) {
	cases := []struct {
		count int
		want  []string
	}{
		{0, nil},
		{-3, nil},
		{1, []string{"a"}},
		{4, []string{"a", "b", "c", "d"}},
		{26, alphabetA2Z()},
		// Clamped: ask for more than the alphabet, get the alphabet.
		{99, alphabetA2Z()},
	}
	for _, c := range cases {
		got := SubproblemLabels(c.count)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("SubproblemLabels(%d) = %v, want %v", c.count, got, c.want)
		}
	}
}

func alphabetA2Z() []string {
	out := make([]string, 26)
	for i := range 26 {
		out[i] = string(rune('a' + i))
	}
	return out
}
