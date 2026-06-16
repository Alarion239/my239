// Package homework contains pure helpers for the homework submission/grading
// feature: photo-upload policy (counts, sizes, allowed MIME types), object
// key conventions, and event-kind transition rules.
package homework

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// Photo and body limits enforced by every event-creating endpoint. Mirrored
// by CHECK constraints on homework_thread_event_photo so a misbehaving client
// cannot slip past Go-side validation by talking directly to PG.
const (
	MaxPhotosPerEvent = 10
	MaxPhotoBytes     = 5 * 1024 * 1024 // 5 MiB
	MaxBodyChars      = 4000
)

// allowedContentTypes maps each accepted image MIME type to the file
// extension we store in the object key. Lowercase for case-insensitive
// matching.
var allowedContentTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/heic": "heic",
	"image/webp": "webp",
}

// ExtForContentType returns the canonical extension we use in object keys
// for the given MIME type, and reports whether the type is accepted.
func ExtForContentType(ct string) (string, bool) {
	ext, ok := allowedContentTypes[strings.ToLower(strings.TrimSpace(ct))]
	return ext, ok
}

// ValidatePhotoBatch enforces the per-event count cap and per-photo MIME
// allowlist. Empty input is rejected because callers should not ask for
// presigned URLs without intending to upload anything.
func ValidatePhotoBatch(contentTypes []string) error {
	if len(contentTypes) == 0 {
		return fmt.Errorf("at least one content_type is required")
	}
	if len(contentTypes) > MaxPhotosPerEvent {
		return fmt.Errorf("at most %d photos per event", MaxPhotosPerEvent)
	}
	for _, ct := range contentTypes {
		if _, ok := ExtForContentType(ct); !ok {
			return fmt.Errorf("unsupported content_type %q", ct)
		}
	}
	return nil
}

// ValidateBody trims and length-checks an event body (free-text comment).
// Empty is allowed for submissions (a photo-only attempt is fine); the
// grade handler enforces non-empty separately because feedback is required.
func ValidateBody(body string) (string, error) {
	trimmed := strings.TrimSpace(body)
	if len([]rune(trimmed)) > MaxBodyChars {
		return "", fmt.Errorf("body must be at most %d characters", MaxBodyChars)
	}
	return trimmed, nil
}

// NewEventUUID returns a 32-hex-char random identifier, used as the event
// UUID and folded into object keys before any DB row exists. We don't pull
// in google/uuid for this single use; 16 random bytes is plenty.
func NewEventUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("homework: gen event uuid: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ObjectKeyPrefix is the bucket-key prefix used by every photo on a given
// event. Computed identically by upload-url and finalize handlers so the
// finalize step can reject foreign keys that don't match this layout.
func ObjectKeyPrefix(threadID int64, eventUUID string) string {
	return fmt.Sprintf("homework/thread/%d/%s/", threadID, eventUUID)
}

// ObjectKey is the full key for a single photo in the event's batch.
func ObjectKey(threadID int64, eventUUID string, idx int, ext string) string {
	return fmt.Sprintf("%s%d.%s", ObjectKeyPrefix(threadID, eventUUID), idx, ext)
}
