package objectstore_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Alarion239/my239/backend/pkg/objectstore"
)

func TestNewS3_RejectsMissingFields(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		cfg  objectstore.S3Config
		want string
	}{
		{
			name: "missing bucket",
			cfg:  objectstore.S3Config{Region: "ru-central1", AccessKeyID: "id", SecretAccessKey: "sk"},
			want: "bucket",
		},
		{
			name: "missing region",
			cfg:  objectstore.S3Config{Bucket: "b", AccessKeyID: "id", SecretAccessKey: "sk"},
			want: "region",
		},
		{
			name: "missing access key",
			cfg:  objectstore.S3Config{Bucket: "b", Region: "ru-central1", SecretAccessKey: "sk"},
			want: "access key",
		},
		{
			name: "missing secret",
			cfg:  objectstore.S3Config{Bucket: "b", Region: "ru-central1", AccessKeyID: "id"},
			want: "access key",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := objectstore.NewS3(context.Background(), tc.cfg)
			if err == nil {
				t.Fatal("NewS3: want error, got nil")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("NewS3 err = %q, want contains %q", err.Error(), tc.want)
			}
		})
	}
}

func TestNewS3_AcceptsYandexConfig(t *testing.T) {
	t.Parallel()
	store, err := objectstore.NewS3(context.Background(), objectstore.S3Config{
		Endpoint:        "https://storage.yandexcloud.net",
		Region:          "ru-central1",
		Bucket:          "my-bucket",
		AccessKeyID:     "id",
		SecretAccessKey: "secret",
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatalf("NewS3: %v", err)
	}
	if store == nil {
		t.Fatal("NewS3: nil store")
	}
}

// TestPresignGetTargetsConfiguredEndpoint verifies the presigned GET URL is
// built against the configured endpoint host (browser-reachable for Yandex)
// and carries a signature. The host is what SigV4 signs over, so a mismatch is
// what 403s on fetch.
func TestPresignGetTargetsConfiguredEndpoint(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t)

	url, err := store.PresignGetForTest(context.Background(), "mathcenter/series/1.pdf", time.Minute)
	if err != nil {
		t.Fatalf("PresignGetForTest: %v", err)
	}
	if !strings.Contains(url, "storage.yandexcloud.net/") {
		t.Errorf("presigned URL should target the configured host; got %q", url)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("presigned URL missing signature query; got %q", url)
	}
}

// TestPresignPutTargetsConfiguredEndpoint mirrors the GET version for uploads:
// the URL the client PUTs to must be on the configured host or the bucket 403s
// on signature verification.
func TestPresignPutTargetsConfiguredEndpoint(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t)

	url, err := store.PresignPut(context.Background(), "homework/thread/1/abc/0.jpg", "image/jpeg", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.Contains(url, "storage.yandexcloud.net/") {
		t.Errorf("PresignPut URL should target the configured host; got %q", url)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("PresignPut URL missing signature query; got %q", url)
	}
}

func TestPresignPutZeroTTL(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t)
	_, err := store.PresignPut(context.Background(), "k", "image/jpeg", 0)
	if err == nil {
		t.Error("PresignPut ttl=0: want error")
	}
}

func newPresignTestStore(t *testing.T) *objectstore.S3Store {
	t.Helper()
	store, err := objectstore.NewS3(context.Background(), objectstore.S3Config{
		Endpoint:        "https://storage.yandexcloud.net",
		Region:          "ru-central1",
		Bucket:          "my239-dev",
		AccessKeyID:     "id",
		SecretAccessKey: "sk",
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatalf("NewS3: %v", err)
	}
	return store
}
