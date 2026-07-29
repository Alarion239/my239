package googlesheets

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"testing"
)

func TestSpreadsheetIDFromURL(t *testing.T) {
	t.Parallel()
	const id = "1Abcdefghijklmnopqrstuvwxyz_0123456789"
	for _, value := range []string{
		id,
		"https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0",
	} {
		got, err := SpreadsheetIDFromURL(value)
		if err != nil || got != id {
			t.Fatalf("SpreadsheetIDFromURL(%q) = %q, %v; want %q, nil", value, got, err, id)
		}
	}
}

func TestSpreadsheetIDFromURLRejectsUntrustedURL(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		"https://example.com/spreadsheets/d/1Abcdefghijklmnopqrstuvwxyz_0123456789/edit",
		"http://docs.google.com/spreadsheets/d/1Abcdefghijklmnopqrstuvwxyz_0123456789/edit",
		"https://docs.google.com/spreadsheets/d/short/edit",
	} {
		if _, err := SpreadsheetIDFromURL(value); err == nil {
			t.Errorf("SpreadsheetIDFromURL(%q) unexpectedly succeeded", value)
		}
	}
}

func TestNewHTTPClientRejectsMissingConfiguration(t *testing.T) {
	t.Parallel()
	if _, err := NewHTTPClient(""); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("NewHTTPClient(empty) error = %v, want ErrNotConfigured", err)
	}
}

func TestServiceAccountEmailExtractedFromJSON(t *testing.T) {
	t.Parallel()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal test key: %v", err)
	}
	credential, err := json.Marshal(map[string]string{
		"client_email": "my239-sheets@my239-503914.iam.gserviceaccount.com",
		"private_key":  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
	})
	if err != nil {
		t.Fatalf("marshal credentials: %v", err)
	}

	service, err := NewService(nil, string(credential))
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if got := service.ServiceAccountEmail(); got != "my239-sheets@my239-503914.iam.gserviceaccount.com" {
		t.Fatalf("ServiceAccountEmail() = %q, want JSON client_email", got)
	}
}
