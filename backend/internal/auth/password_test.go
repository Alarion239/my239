package auth

import (
	"strings"
	"testing"
)

// testParams are deliberately weak so the suite stays fast. argon2id with
// production parameters costs ~100ms per hash; tests don't need that.
var testParams = Argon2idParams{
	Memory:      8,
	Iterations:  1,
	Parallelism: 1,
	SaltLength:  8,
	KeyLength:   16,
}

func TestHashPassword_Format(t *testing.T) {
	hash, err := HashPasswordWith("securepassword", testParams)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("encoded hash should start with $argon2id$; got %q", hash)
	}
	parts := strings.Split(hash, "$")
	if len(parts) != 6 {
		t.Errorf("encoded hash should have 6 dollar-separated parts; got %d (%v)", len(parts), parts)
	}
}

func TestHashPassword_NotPlaintext(t *testing.T) {
	hash, err := HashPasswordWith("securepassword", testParams)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(hash, "securepassword") {
		t.Error("hash must not contain the plaintext password")
	}
}

func TestHashPassword_DifferentEachTime(t *testing.T) {
	a, _ := HashPasswordWith("samepassword", testParams)
	b, _ := HashPasswordWith("samepassword", testParams)
	if a == b {
		t.Error("two hashes of the same password must differ (random salt)")
	}
}

func TestHashPassword_TooShort(t *testing.T) {
	if _, err := HashPasswordWith("short", testParams); err == nil {
		t.Fatal("expected error for password shorter than min length")
	}
}

func TestCheckPassword_Correct(t *testing.T) {
	hash, err := HashPasswordWith("securepassword", testParams)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckPassword("securepassword", hash); err != nil {
		t.Errorf("expected correct password to verify, got %v", err)
	}
}

func TestCheckPassword_Wrong(t *testing.T) {
	hash, err := HashPasswordWith("securepassword", testParams)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckPassword("wrongpassword", hash); err == nil {
		t.Fatal("expected error for wrong password")
	}
}

func TestCheckPassword_MalformedHash(t *testing.T) {
	cases := []string{
		"",
		"plaintext",
		"$argon2id$badformat",
		"$argon2id$v=19$m=8,t=1,p=1$BADSALT$BADKEY",
		"$argon2i$v=19$m=8,t=1,p=1$YWFhYWFhYWE$YWFhYWFhYWFhYWFhYWFh", // wrong variant
	}
	for _, h := range cases {
		if err := CheckPassword("any", h); err == nil {
			t.Errorf("expected error for malformed hash %q", h)
		}
	}
}

// TestProductionParamsRoundTrip uses the real DefaultArgon2idParams for one
// happy path. This is the only test that pays the production cost
// (~100ms), which is acceptable for a single round-trip.
func TestProductionParamsRoundTrip(t *testing.T) {
	hash, err := HashPassword("securepassword")
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckPassword("securepassword", hash); err != nil {
		t.Errorf("production-parameter round trip failed: %v", err)
	}
}
