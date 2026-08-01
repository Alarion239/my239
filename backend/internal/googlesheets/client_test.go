package googlesheets

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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

func TestNewHTTPClientRejectsMalformedCredentialsWithoutLeakingThem(t *testing.T) {
	t.Parallel()
	const secret = "representative-private-key"
	for _, test := range []struct {
		name        string
		credentials string
	}{
		{name: "invalid JSON", credentials: "not-json-" + secret},
		{name: "invalid private key", credentials: fmt.Sprintf(`{"client_email":"sheets@example.com","private_key":%q}`, secret)},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := NewHTTPClient(test.credentials)
			if err == nil {
				t.Fatal("NewHTTPClient() unexpectedly succeeded")
			}
			if strings.Contains(err.Error(), secret) {
				t.Fatalf("NewHTTPClient() error leaked credential material: %v", err)
			}
		})
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

func TestMetadataReportsContentWriteCapability(t *testing.T) {
	t.Parallel()
	const spreadsheetID = "1Abcdefghijklmnopqrstuvwxyz_0123456789"
	for _, test := range []struct {
		name             string
		canModifyContent bool
	}{
		{name: "reader", canModifyContent: false},
		{name: "editor", canModifyContent: true},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			client := &HTTPClient{
				httpClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					if got := request.URL.Query().Get("fields"); got != "version,modifiedTime,capabilities(canModifyContent)" {
						t.Fatalf("metadata fields = %q", got)
					}
					body, err := json.Marshal(map[string]any{
						"version":      "17",
						"modifiedTime": "2026-07-29T12:00:00Z",
						"capabilities": map[string]bool{"canModifyContent": test.canModifyContent},
					})
					if err != nil {
						t.Fatalf("marshal response: %v", err)
					}
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       io.NopCloser(strings.NewReader(string(body))),
						Header:     make(http.Header),
					}, nil
				})},
				accessTok: "test-token",
				expiresAt: time.Now().Add(time.Hour),
			}

			metadata, err := client.Metadata(t.Context(), spreadsheetID)
			if err != nil {
				t.Fatalf("Metadata() error = %v", err)
			}
			if metadata.CanModifyContent != test.canModifyContent {
				t.Fatalf("CanModifyContent = %v, want %v", metadata.CanModifyContent, test.canModifyContent)
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
