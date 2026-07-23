package googlesheets

import (
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
