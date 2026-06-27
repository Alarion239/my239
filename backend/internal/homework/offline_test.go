package homework

import "testing"

func TestCanTransition_OfflineAccept(t *testing.T) {
	for _, status := range []string{StatusUngraded, StatusSubmitted, StatusRejected, StatusAppealed} {
		if err := CanTransition(status, KindAcceptedOffline); err != nil {
			t.Errorf("accepted_offline should be legal from %q, got %v", status, err)
		}
	}
	// Already accepted → not legal (handler treats it as a no-op/409).
	if err := CanTransition(StatusAccepted, KindAcceptedOffline); err == nil {
		t.Error("accepted_offline should be illegal from 'accepted'")
	}
}

func TestCanTransition_OfflineRetract(t *testing.T) {
	if err := CanTransition(StatusAccepted, KindOfflineRetracted); err != nil {
		t.Errorf("offline_retracted should be legal from 'accepted', got %v", err)
	}
	for _, status := range []string{StatusUngraded, StatusSubmitted, StatusRejected, StatusAppealed} {
		if err := CanTransition(status, KindOfflineRetracted); err == nil {
			t.Errorf("offline_retracted should be illegal from %q", status)
		}
	}
}

func TestCreditedName_ResolvedTeacherWins(t *testing.T) {
	got, err := CreditedName("Мария", "Кузнецова", "ignored free text")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Мария Кузнецова" {
		t.Errorf("got %q, want full resolved name", got)
	}
}

func TestCreditedName_FreeTextFallback(t *testing.T) {
	got, err := CreditedName("", "", "  Иванов  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Иванов" {
		t.Errorf("got %q, want trimmed free text", got)
	}
}

func TestCreditedName_RequiresSomething(t *testing.T) {
	if _, err := CreditedName("", "", "   "); err == nil {
		t.Error("expected error when neither resolved name nor free text given")
	}
}

func TestCreditedName_TooLong(t *testing.T) {
	long := make([]rune, MaxGraderNameChars+1)
	for i := range long {
		long[i] = 'я'
	}
	if _, err := CreditedName("", "", string(long)); err == nil {
		t.Error("expected error for over-long grader name")
	}
}

func TestFullName(t *testing.T) {
	cases := map[string]struct{ first, last, want string }{
		"both":       {"Мария", "Кузнецова", "Мария Кузнецова"},
		"first only": {"Мария", "", "Мария"},
		"last only":  {"", "Кузнецова", "Кузнецова"},
		"neither":    {"", "", ""},
		"spaces":     {"  Мария ", " Кузнецова ", "Мария Кузнецова"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := FullName(tc.first, tc.last); got != tc.want {
				t.Errorf("FullName(%q,%q) = %q, want %q", tc.first, tc.last, got, tc.want)
			}
		})
	}
}
