// Package mathcenter contains domain helpers for the Math Center club —
// grade computation and the Russian display-name conventions used everywhere
// the math center surface renders names.
package mathcenter

import (
	"strings"
	"time"
)

// Grade returns the school grade (1–11) for a cohort with the given graduation
// year, evaluated against `now`. Russian schools run Sep 1 → late May/early
// June; the academic year for a date in Sep–Dec is (calendar year)+1, and for
// Jan–Aug it's the calendar year itself.
//
// Examples (today is in academic year 2025/2026):
//
//	graduationYear=2026 → 11th grade
//	graduationYear=2027 → 10th grade
//	graduationYear=2036 → 1st grade
//
// Cohorts past graduation return values > 11; pre-1st grade cohorts return
// values < 1. Callers can clamp or display "выпустились" / "не учатся" as
// they see fit.
func Grade(graduationYear int, now time.Time) int {
	ay := now.Year()
	if int(now.Month()) >= 9 {
		ay++
	}
	return 11 - (graduationYear - ay)
}

// TeacherDisplayName returns the "Имя Отчество" form used wherever a teacher's
// name is shown (to students or to other teachers). Falls back gracefully if
// the patronymic (middle_name) is missing.
func TeacherDisplayName(firstName string, middleName *string) string {
	if middleName != nil && *middleName != "" {
		return strings.TrimSpace(firstName) + " " + strings.TrimSpace(*middleName)
	}
	return strings.TrimSpace(firstName)
}

// StudentDisplayName returns the "Имя Фамилия" form used in the teacher-facing
// student list. We don't show patronymic for students because the class roster
// is informal.
func StudentDisplayName(firstName, lastName string) string {
	first := strings.TrimSpace(firstName)
	last := strings.TrimSpace(lastName)
	if last == "" {
		return first
	}
	return first + " " + last
}
