package mathcenter

import "fmt"

const (
	TermKindAcademic = "academic"
	TermKindCamp     = "camp"
	TermKindLegacy   = "legacy"
)

// TermDisplayName is the stable Russian label used by the archive picker and
// problem references. A camp belongs to the grade just completed.
func TermDisplayName(kind string, grade *int32) string {
	if kind == TermKindLegacy {
		return "Предыдущие годы"
	}
	if grade == nil {
		return "Архив"
	}
	if kind == TermKindCamp {
		return fmt.Sprintf("%d класс · Лагерь", *grade)
	}
	return fmt.Sprintf("%d класс", *grade)
}

// TermReferencePrefix distinguishes archived academic and camp problems after
// their per-term series numbering has reset. Active-term problems keep their
// compact historical labels and therefore do not use this helper.
func TermReferencePrefix(kind string, grade *int32) string {
	if kind == TermKindLegacy || grade == nil {
		return "Архив"
	}
	if kind == TermKindCamp {
		return fmt.Sprintf("%dЛ", *grade)
	}
	return fmt.Sprintf("%d", *grade)
}

// TermStage returns the ordering position of a normal term. The zero value is
// deliberately invalid: legacy terms do not participate in progression.
func TermStage(kind string, grade int32) (int, bool) {
	if grade < 5 || grade > 11 {
		return 0, false
	}
	base := int(grade-5) * 2
	switch kind {
	case TermKindAcademic:
		return base + 1, true
	case TermKindCamp:
		if grade == 11 {
			return 0, false
		}
		return base + 2, true
	default:
		return 0, false
	}
}
