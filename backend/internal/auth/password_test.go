package auth

import (
	"testing"
)

func TestHashPassword(t *testing.T) {
	hash, err := HashPassword("securepassword")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hash == "" {
		t.Fatal("expected non-empty hash")
	}
	if hash == "securepassword" {
		t.Fatal("hash must not equal the original password")
	}
}

func TestHashPassword_TooShort(t *testing.T) {
	_, err := HashPassword("short")
	if err == nil {
		t.Fatal("expected error for password shorter than 8 characters")
	}
}

func TestCheckPassword(t *testing.T) {
	password := "securepassword"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("unexpected error hashing password: %v", err)
	}

	if err := CheckPassword(password, hash); err != nil {
		t.Fatalf("expected correct password to pass: %v", err)
	}
}

func TestCheckPassword_Wrong(t *testing.T) {
	hash, err := HashPassword("securepassword")
	if err != nil {
		t.Fatalf("unexpected error hashing password: %v", err)
	}

	if err := CheckPassword("wrongpassword", hash); err == nil {
		t.Fatal("expected error for wrong password")
	}
}
