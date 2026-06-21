package homework

import "time"

// SubmissionClosed reports whether NEW submissions are closed for a subproblem.
//
// A normal problem closes at the series due time. A coffin (гроб) is the
// exception: it stays open past the deadline until its own solution is released
// — `coffinReleasedAt` set and not in the future. A coffin with no release date
// is open indefinitely. Appeals are governed separately and never gated here.
func SubmissionClosed(isCoffin bool, coffinReleasedAt *time.Time, seriesDueAt, now time.Time) bool {
	if isCoffin {
		return coffinReleasedAt != nil && !now.Before(*coffinReleasedAt)
	}
	return !now.Before(seriesDueAt)
}
