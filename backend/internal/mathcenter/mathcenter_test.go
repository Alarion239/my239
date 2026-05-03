package mathcenter

import (
	"testing"
	"time"
)

func TestGrade(t *testing.T) {
	type tc struct {
		name           string
		graduationYear int
		now            time.Time
		want           int
	}
	cases := []tc{
		// Academic year 2025/2026 — anywhere from Sep 2025 to Aug 2026.
		{"11th in May", 2026, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), 11},
		{"10th in May", 2027, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), 10},
		{"1st in May", 2036, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), 1},
		// Sep 1 flips the academic year — this same cohort is now 11th.
		{"11th in Sep", 2027, time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC), 11},
		{"graduated", 2025, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), 12},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Grade(c.graduationYear, c.now); got != c.want {
				t.Errorf("Grade(%d, %v) = %d, want %d", c.graduationYear, c.now, got, c.want)
			}
		})
	}
}

func TestDisplayNames(t *testing.T) {
	patronymic := "Иванович"
	if got := TeacherDisplayName("Иван", &patronymic); got != "Иван Иванович" {
		t.Errorf("teacher: got %q", got)
	}
	if got := TeacherDisplayName("Анна", nil); got != "Анна" {
		t.Errorf("teacher no patronymic: got %q", got)
	}
	if got := StudentDisplayName("Алексей", "Петров"); got != "Алексей Петров" {
		t.Errorf("student: got %q", got)
	}
	if got := StudentDisplayName("Алексей", ""); got != "Алексей" {
		t.Errorf("student no last name: got %q", got)
	}
}
