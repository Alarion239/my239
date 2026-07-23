package mathcenter

import (
	"testing"

	"github.com/Alarion239/my239/backend/internal/store"
)

func TestIsNextTerm(t *testing.T) {
	gradeFive := int32(5)
	gradeSix := int32(6)
	cases := []struct {
		name  string
		terms []store.MathCenterTerm
		kind  string
		grade int32
		want  bool
	}{
		{
			name:  "legacy import may start at current grade",
			terms: []store.MathCenterTerm{{Kind: "legacy"}},
			kind:  "academic",
			grade: gradeSix,
			want:  true,
		},
		{
			name:  "camp follows school year",
			terms: []store.MathCenterTerm{{Kind: "academic", Grade: &gradeFive}},
			kind:  "camp",
			grade: gradeFive,
			want:  true,
		},
		{
			name:  "cannot skip camp",
			terms: []store.MathCenterTerm{{Kind: "academic", Grade: &gradeFive}},
			kind:  "academic",
			grade: gradeSix,
			want:  false,
		},
		{
			name:  "sixth academic follows fifth camp",
			terms: []store.MathCenterTerm{{Kind: "camp", Grade: &gradeFive}},
			kind:  "academic",
			grade: gradeSix,
			want:  true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNextTerm(tc.terms, tc.kind, tc.grade); got != tc.want {
				t.Fatalf("isNextTerm() = %t, want %t", got, tc.want)
			}
		})
	}
}
