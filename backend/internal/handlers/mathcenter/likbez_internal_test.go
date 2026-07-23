package mathcenter

import "testing"

func TestValidateLikbezFields(t *testing.T) {
	date, message := validateLikbezFields(3, 12, "Графы", "2026-07-23", "Инварианты и раскраски.")
	if message != "" || !date.Valid {
		t.Fatalf("valid payload rejected: date=%+v message=%q", date, message)
	}

	for _, test := range []struct {
		name                       string
		term                       int64
		num                        int
		title, heldOn, description string
	}{
		{name: "missing period", num: 1, title: "x", heldOn: "2026-07-23", description: "x"},
		{name: "zero number", term: 3, title: "x", heldOn: "2026-07-23", description: "x"},
		{name: "bad date", term: 3, num: 1, title: "x", heldOn: "23.07.2026", description: "x"},
		{name: "blank title", term: 3, num: 1, heldOn: "2026-07-23", description: "x"},
		{name: "blank description", term: 3, num: 1, title: "x", heldOn: "2026-07-23"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, message := validateLikbezFields(test.term, test.num, test.title, test.heldOn, test.description); message == "" {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestLikbezObjectKey(t *testing.T) {
	if got := likbezObjectKey(42); got != "mathcenter/likbez/42.pdf" {
		t.Fatalf("object key = %q", got)
	}
}
