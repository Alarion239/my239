package mathcenter

import (
	"strings"
	"testing"
)

func TestNormalizeTexSourceAcceptsBodyOnly(t *testing.T) {
	body := "\\section*{Задача}\n$x^2+y^2$"
	got := normalizeTexSource(body)

	for _, want := range []string{
		DefaultLatexPreamble,
		"\\begin{document}",
		body,
		"\\end{document}",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("normalized source missing %q", want)
		}
	}
}

func TestNormalizeTexSourcePreservesCompleteDocument(t *testing.T) {
	full := "\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n"
	if got := normalizeTexSource(full); got != full {
		t.Fatalf("complete document was changed: %q", got)
	}
}

func TestValidateLatexPreamble(t *testing.T) {
	for _, tc := range []struct {
		name  string
		text  string
		valid bool
	}{
		{name: "valid", text: DefaultLatexPreamble, valid: true},
		{name: "missing document class", text: "\\usepackage{amsmath}"},
		{name: "contains document marker", text: DefaultLatexPreamble + "\n\\begin{document}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := validateLatexPreamble(tc.text)
			if tc.valid && got != "" {
				t.Fatalf("valid preamble rejected: %s", got)
			}
			if !tc.valid && got == "" {
				t.Fatal("invalid preamble accepted")
			}
		})
	}
}
