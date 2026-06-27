package homework

import (
	"fmt"
	"strings"
)

// MaxGraderNameChars caps a free-text credited grader name. Generous enough
// for "Фамилия Имя" yet short enough that the cell stays a cell.
const MaxGraderNameChars = 80

// CreditedName resolves the display name to credit for an offline accept,
// given an optionally-resolved registered teacher and a free-text fallback.
//
//   - When the initials matched a registered teacher, pass their first/last
//     name; the full "Имя Фамилия" is used and freeText is ignored.
//   - Otherwise freeText is trimmed and used (an unregistered grader).
//
// Returns an error when neither yields a non-empty, in-bounds name.
func CreditedName(resolvedFirst, resolvedLast string, freeText string) (string, error) {
	if full := FullName(resolvedFirst, resolvedLast); full != "" {
		if len([]rune(full)) > MaxGraderNameChars {
			return "", fmt.Errorf("credited grader name too long")
		}
		return full, nil
	}
	name := strings.TrimSpace(freeText)
	if name == "" {
		return "", fmt.Errorf("grader name is required")
	}
	if len([]rune(name)) > MaxGraderNameChars {
		return "", fmt.Errorf("grader name at most %d characters", MaxGraderNameChars)
	}
	return name, nil
}

// FullName joins a first and last name into a trimmed "First Last", dropping
// either part when empty. Used both to credit a resolved teacher and as the
// denormalized last_grader_name the conduit derives initials from.
func FullName(first, last string) string {
	return strings.TrimSpace(strings.TrimSpace(first) + " " + strings.TrimSpace(last))
}
