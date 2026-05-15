package homework_test

import (
	"strings"
	"testing"

	"github.com/Alarion239/my239/backend/internal/homework"
)

func TestExtForContentType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in     string
		wantOK bool
		want   string
	}{
		{"image/jpeg", true, "jpg"},
		{"IMAGE/JPEG", true, "jpg"},
		{"  image/png  ", true, "png"},
		{"image/heic", true, "heic"},
		{"image/webp", true, "webp"},
		{"image/gif", false, ""},
		{"application/pdf", false, ""},
		{"", false, ""},
	}
	for _, c := range cases {
		got, ok := homework.ExtForContentType(c.in)
		if ok != c.wantOK || got != c.want {
			t.Errorf("ExtForContentType(%q) = %q,%v; want %q,%v", c.in, got, ok, c.want, c.wantOK)
		}
	}
}

func TestValidatePhotoBatch(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		in      []string
		wantErr bool
	}{
		{"empty rejected", nil, true},
		{"one valid", []string{"image/jpeg"}, false},
		{"max valid", []string{"image/jpeg", "image/png", "image/heic", "image/webp", "image/jpeg", "image/png", "image/heic", "image/webp", "image/jpeg", "image/png"}, false},
		{"too many", []string{"image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg"}, true},
		{"bad mime", []string{"image/jpeg", "image/gif"}, true},
		{"pdf rejected", []string{"application/pdf"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := homework.ValidatePhotoBatch(c.in)
			if (err != nil) != c.wantErr {
				t.Errorf("ValidatePhotoBatch: err=%v, wantErr=%v", err, c.wantErr)
			}
		})
	}
}

func TestValidateBody(t *testing.T) {
	t.Parallel()
	// Trims and accepts within limit.
	got, err := homework.ValidateBody("  hello  ")
	if err != nil {
		t.Fatalf("ValidateBody: %v", err)
	}
	if got != "hello" {
		t.Errorf("got %q, want trimmed 'hello'", got)
	}

	// Over limit (count by rune so we cover unicode too).
	big := strings.Repeat("Я", homework.MaxBodyChars+1)
	if _, err := homework.ValidateBody(big); err == nil {
		t.Error("ValidateBody: want error for oversize body")
	}
}

func TestNewEventUUID(t *testing.T) {
	t.Parallel()
	a, err := homework.NewEventUUID()
	if err != nil {
		t.Fatalf("NewEventUUID: %v", err)
	}
	b, _ := homework.NewEventUUID()
	if len(a) != 32 || len(b) != 32 {
		t.Errorf("uuid lengths: %d, %d (want 32)", len(a), len(b))
	}
	if a == b {
		t.Error("two consecutive uuids collided")
	}
}

func TestObjectKey(t *testing.T) {
	t.Parallel()
	prefix := homework.ObjectKeyPrefix(42, "abcdef")
	if prefix != "homework/thread/42/abcdef/" {
		t.Errorf("prefix: got %q", prefix)
	}
	k := homework.ObjectKey(42, "abcdef", 3, "jpg")
	if k != "homework/thread/42/abcdef/3.jpg" {
		t.Errorf("ObjectKey: got %q", k)
	}
	if !strings.HasPrefix(k, prefix) {
		t.Errorf("ObjectKey must extend ObjectKeyPrefix")
	}
}

func TestCanTransition(t *testing.T) {
	t.Parallel()
	cases := []struct {
		status, kind string
		wantOK       bool
	}{
		// Legal
		{homework.StatusUngraded, homework.KindSubmitted, true},
		{homework.StatusSubmitted, homework.KindClaimed, true},
		{homework.StatusSubmitted, homework.KindReleased, true},
		{homework.StatusSubmitted, homework.KindGraded, true},
		{homework.StatusRejected, homework.KindSubmitted, true},
		{homework.StatusRejected, homework.KindAppealed, true},
		{homework.StatusRejected, homework.KindRetracted, true},
		{homework.StatusAppealed, homework.KindGraded, true},
		{homework.StatusAccepted, homework.KindRetracted, true},
		// Illegal
		{homework.StatusUngraded, homework.KindGraded, false},
		{homework.StatusSubmitted, homework.KindAppealed, false},
		{homework.StatusAccepted, homework.KindSubmitted, false},
		{homework.StatusAccepted, homework.KindAppealed, false},
		{homework.StatusAppealed, homework.KindAppealed, false},
		{homework.StatusUngraded, homework.KindRetracted, false},
	}
	for _, c := range cases {
		err := homework.CanTransition(c.status, c.kind)
		if (err == nil) != c.wantOK {
			t.Errorf("CanTransition(%s,%s): err=%v, wantOK=%v", c.status, c.kind, err, c.wantOK)
		}
	}
}
