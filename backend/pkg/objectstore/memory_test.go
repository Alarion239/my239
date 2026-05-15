package objectstore_test

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

func TestMemoryStore_PutGetExistsDelete(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := objectstore.NewMemory()

	const key = "series/1/problems.pdf"
	body := strings.NewReader("hello pdf")

	if err := store.Put(ctx, key, body, int64(len("hello pdf")), "application/pdf"); err != nil {
		t.Fatalf("Put: %v", err)
	}

	exists, err := store.Exists(ctx, key)
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if !exists {
		t.Fatal("Exists: want true after Put")
	}

	r, ct, ok := store.Get(key)
	if !ok {
		t.Fatal("Get: want ok after Put")
	}
	if ct != "application/pdf" {
		t.Errorf("Get content-type: got %q, want application/pdf", ct)
	}
	got, _ := io.ReadAll(r)
	if string(got) != "hello pdf" {
		t.Errorf("Get body: got %q, want %q", got, "hello pdf")
	}

	url, err := store.PresignGet(ctx, key, time.Minute)
	if err != nil {
		t.Fatalf("PresignGet: %v", err)
	}
	if !strings.HasPrefix(url, "memory://") || !strings.HasSuffix(url, key) {
		t.Errorf("PresignGet url %q does not match memory:// + key", url)
	}

	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	exists, err = store.Exists(ctx, key)
	if err != nil {
		t.Fatalf("Exists after delete: %v", err)
	}
	if exists {
		t.Error("Exists: want false after Delete")
	}
}

func TestMemoryStore_PresignMissingKey(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	_, err := store.PresignGet(context.Background(), "missing", time.Minute)
	if !errors.Is(err, objectstore.ErrNotFound) {
		t.Errorf("PresignGet missing: got %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_PresignZeroTTL(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	_ = store.Put(context.Background(), "k", strings.NewReader("x"), 1, "")
	_, err := store.PresignGet(context.Background(), "k", 0)
	if err == nil {
		t.Error("PresignGet ttl=0: want error")
	}
}

func TestMemoryStore_DeleteMissingIsNoop(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	if err := store.Delete(context.Background(), "never-put"); err != nil {
		t.Errorf("Delete missing key: got %v, want nil", err)
	}
}

func TestMemoryStore_PresignPut(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	url, err := store.PresignPut(context.Background(), "h/x.jpg", "image/jpeg", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.HasPrefix(url, "memory://put/") || !strings.HasSuffix(url, "h/x.jpg") {
		t.Errorf("PresignPut url %q does not match memory://put/ + key", url)
	}
}

func TestMemoryStore_PresignPutZeroTTL(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	_, err := store.PresignPut(context.Background(), "k", "image/jpeg", 0)
	if err == nil {
		t.Error("PresignPut ttl=0: want error")
	}
}

func TestMemoryStore_Stat(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := objectstore.NewMemory()
	body := strings.NewReader("12345")
	if err := store.Put(ctx, "k", body, 5, "image/png"); err != nil {
		t.Fatalf("Put: %v", err)
	}
	size, ct, err := store.Stat(ctx, "k")
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if size != 5 {
		t.Errorf("Stat size: got %d, want 5", size)
	}
	if ct != "image/png" {
		t.Errorf("Stat content-type: got %q, want image/png", ct)
	}
}

func TestMemoryStore_StatMissing(t *testing.T) {
	t.Parallel()
	store := objectstore.NewMemory()
	_, _, err := store.Stat(context.Background(), "missing")
	if !errors.Is(err, objectstore.ErrNotFound) {
		t.Errorf("Stat missing: got %v, want ErrNotFound", err)
	}
}
