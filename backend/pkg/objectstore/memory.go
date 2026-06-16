package objectstore

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"
	"time"
)

// MemoryStore is an in-process Store used for tests and local dev when no
// real bucket is configured. Presigned URLs returned by this store are not
// fetchable; they exist so handlers can produce a redirect target the test
// can assert against.
type MemoryStore struct {
	mu      sync.RWMutex
	objects map[string]memoryObject
	// urlPrefix is what PresignGet prepends to the key to form the fake URL.
	// Defaults to "memory://" so a redirect can be inspected in tests.
	urlPrefix string
}

type memoryObject struct {
	body        []byte
	contentType string
}

var _ Store = (*MemoryStore)(nil)

// NewMemory returns an empty MemoryStore.
func NewMemory() *MemoryStore {
	return &MemoryStore{
		objects:   make(map[string]memoryObject),
		urlPrefix: "memory://",
	}
}

func (m *MemoryStore) Put(_ context.Context, key string, body io.Reader, _ int64, contentType string) error {
	buf, err := io.ReadAll(body)
	if err != nil {
		return fmt.Errorf("memory put: %w", err)
	}
	m.mu.Lock()
	m.objects[key] = memoryObject{body: buf, contentType: contentType}
	m.mu.Unlock()
	return nil
}

func (m *MemoryStore) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("memory presign: ttl must be positive")
	}
	m.mu.RLock()
	_, ok := m.objects[key]
	m.mu.RUnlock()
	if !ok {
		return "", ErrNotFound
	}
	return m.urlPrefix + key, nil
}

// PresignPut returns a deterministic memory:// URL so handlers can serialize
// something for tests to inspect. The returned URL is not actually fetchable —
// tests that need an upload to "succeed" should call Put afterwards.
func (m *MemoryStore) PresignPut(_ context.Context, key, _ string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("memory presign put: ttl must be positive")
	}
	return m.urlPrefix + "put/" + key, nil
}

// Stat returns the stored size and contentType, or ErrNotFound.
func (m *MemoryStore) Stat(_ context.Context, key string) (int64, string, error) {
	m.mu.RLock()
	obj, ok := m.objects[key]
	m.mu.RUnlock()
	if !ok {
		return 0, "", ErrNotFound
	}
	return int64(len(obj.body)), obj.contentType, nil
}

func (m *MemoryStore) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	delete(m.objects, key)
	m.mu.Unlock()
	return nil
}

func (m *MemoryStore) Exists(_ context.Context, key string) (bool, error) {
	m.mu.RLock()
	_, ok := m.objects[key]
	m.mu.RUnlock()
	return ok, nil
}

// Get is a test convenience that returns the stored body. Not part of the
// Store interface because production code never reads through the server.
func (m *MemoryStore) Get(key string) (io.Reader, string, bool) {
	m.mu.RLock()
	obj, ok := m.objects[key]
	m.mu.RUnlock()
	if !ok {
		return nil, "", false
	}
	return bytes.NewReader(obj.body), obj.contentType, true
}
