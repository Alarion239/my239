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

func TestNewS3_RejectsBadPublicEndpoint(t *testing.T) {
	t.Parallel()
	_, err := objectstore.NewS3(context.Background(), objectstore.S3Config{
		Endpoint:        "http://minio:9000",
		PublicEndpoint:  "not-a-url-at-all",
		Region:          "us-east-1",
		Bucket:          "b",
		AccessKeyID:     "id",
		SecretAccessKey: "sk",
		UsePathStyle:    true,
	})
	if err == nil {
		t.Fatal("want error for missing scheme/host in public endpoint")
	}
}

// TestPresignUsesPublicEndpoint verifies the presigner emits URLs against the
// public endpoint when one is configured. We can't validate the signature
// itself without running MinIO, but we can confirm the host in the URL — the
// host is what SigV4 computes the signature over, so a matching host is the
// thing that breaks when this is wrong (the previous implementation rewrote
// the URL string after signing, which produced 403s on fetch).
func TestPresignUsesPublicEndpoint(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t, "http://localhost:9000")

	url, err := store.PresignGetForTest(context.Background(), "mathcenter/series/1.pdf", time.Minute)
	if err != nil {
		t.Fatalf("PresignGetForTest: %v", err)
	}
	if !strings.Contains(url, "http://localhost:9000/") {
		t.Errorf("presigned URL should target the public host; got %q", url)
	}
	if strings.Contains(url, "minio:9000") {
		t.Errorf("presigned URL leaked the internal hostname; got %q", url)
	}
	// Sanity: the URL should still be a presigned GET (signature query present).
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("presigned URL missing signature query; got %q", url)
	}
}

func TestPresignFallsBackToInternalEndpointWhenPublicUnset(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t, "")

	url, err := store.PresignGetForTest(context.Background(), "mathcenter/series/1.pdf", time.Minute)
	if err != nil {
		t.Fatalf("PresignGetForTest: %v", err)
	}
	if !strings.Contains(url, "http://minio:9000/") {
		t.Errorf("with no public endpoint, presigned URL should use the internal host; got %q", url)
	}
}

// TestPresignPutUsesPublicEndpoint mirrors the GET version: the URL the
// client uploads to must be on the public host, otherwise SigV4 verification
// at Yandex/MinIO will 403 because the Host header on the browser PUT won't
// match the host the SDK signed over.
func TestPresignPutUsesPublicEndpoint(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t, "http://localhost:9000")

	url, err := store.PresignPut(context.Background(), "homework/thread/1/abc/0.jpg", "image/jpeg", time.Minute)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	if !strings.Contains(url, "http://localhost:9000/") {
		t.Errorf("PresignPut URL should target the public host; got %q", url)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("PresignPut URL missing signature query; got %q", url)
	}
}

func TestPresignPutZeroTTL(t *testing.T) {
	t.Parallel()
	store := newPresignTestStore(t, "")
	_, err := store.PresignPut(context.Background(), "k", "image/jpeg", 0)
	if err == nil {
		t.Error("PresignPut ttl=0: want error")
	}
}

func newPresignTestStore(t *testing.T, publicEndpoint string) *objectstore.S3Store {
	t.Helper()
	store, err := objectstore.NewS3(context.Background(), objectstore.S3Config{
		Endpoint:        "http://minio:9000",
		PublicEndpoint:  publicEndpoint,
		Region:          "us-east-1",
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
