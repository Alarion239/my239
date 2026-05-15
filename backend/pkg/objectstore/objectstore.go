// Package objectstore is the storage abstraction for binary blobs (PDFs,
// images, …). Business code depends on the Store interface, never on the AWS
// SDK directly, so handler tests can run against MemoryStore without hitting
// the network.
//
// In production we use S3Store backed by Yandex Object Storage (which speaks
// the S3 API). When no bucket is configured the server falls back to
// MemoryStore so local development and tests just work.
package objectstore

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotFound is returned by PresignGet, Delete, and Exists callers as the
// canonical "this key isn't in the bucket" error. Implementations wrap their
// SDK-specific not-found error into this so business code can branch on a
// single sentinel.
var ErrNotFound = errors.New("objectstore: not found")

// Store is the minimum surface needed by the math center series feature
// (and anything else we add later). Keep it small — every method here is
// something both MemoryStore and S3Store must implement.
type Store interface {
	// Put stores body under key. size and contentType are advisory: the S3
	// implementation needs them to set Content-Length / Content-Type on the
	// uploaded object so presigned downloads serve correctly.
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error

	// PresignGet returns a time-limited URL the client can hit directly to
	// download the object. ttl must be > 0. Returns ErrNotFound when the
	// key doesn't exist (where the implementation can detect that cheaply).
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)

	// PresignPut returns a time-limited URL the client uses to upload bytes
	// directly to the bucket with HTTP PUT. The client MUST send the same
	// Content-Type the server signed for — Yandex/S3 verify the header
	// against the signature and 403 if they differ. ttl must be > 0.
	PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (string, error)

	// Stat returns the size and Content-Type of an existing object, or
	// ErrNotFound if the key is absent. Used by finalize handlers to verify
	// a client-uploaded object meets the size/type policy before the server
	// writes a row that points at it.
	Stat(ctx context.Context, key string) (size int64, contentType string, err error)

	// Delete removes the object. Returns nil if the key didn't exist —
	// "make sure it's gone" semantics, since callers usually call this
	// during cleanup and don't want to handle a 404 they don't care about.
	Delete(ctx context.Context, key string) error

	// Exists reports whether the key is present.
	Exists(ctx context.Context, key string) (bool, error)
}
