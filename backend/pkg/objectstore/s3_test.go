package objectstore_test

import (
	"context"
	"strings"
	"testing"

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
