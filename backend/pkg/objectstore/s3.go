package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsConfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// S3Config carries the bits needed to talk to an S3-compatible service.
// Empty Endpoint means "use AWS defaults"; for Yandex set it to
// https://storage.yandexcloud.net.
type S3Config struct {
	Endpoint string
	// PublicEndpoint, if non-empty, is substituted into presigned URLs in
	// place of Endpoint. Needed for dev with MinIO inside Docker, where the
	// backend reaches the API via http://minio:9000 but the browser must use
	// http://localhost:9000. Leave empty in prod (Yandex returns
	// browser-reachable hostnames already).
	PublicEndpoint  string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// UsePathStyle forces path-style addressing (bucket in URL path) instead
	// of virtual-host style. Yandex supports both, but path-style avoids DNS
	// surprises when the bucket name has dots.
	UsePathStyle bool
}

// S3Store is the production Store backed by any S3-compatible service.
type S3Store struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
}

// NewS3 builds an S3Store from cfg. The constructor does not make network
// calls; first failure surfaces on the first Put / Presign / Delete.
func NewS3(ctx context.Context, cfg S3Config) (*S3Store, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("objectstore: bucket is required")
	}
	if cfg.Region == "" {
		return nil, errors.New("objectstore: region is required")
	}
	if cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, errors.New("objectstore: access key id and secret are required")
	}

	loaded, err := awsConfig.LoadDefaultConfig(ctx,
		awsConfig.WithRegion(cfg.Region),
		awsConfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID, cfg.SecretAccessKey, "",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("objectstore: load aws config: %w", err)
	}

	client := s3.NewFromConfig(loaded, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		o.UsePathStyle = cfg.UsePathStyle
	})

	// When a separate public endpoint is configured, build a parallel client
	// for presigning so the signed URL's host matches what the browser will
	// actually request. Presigning is purely client-side — this client never
	// makes a network call, so it doesn't matter that "localhost:9000" isn't
	// reachable from inside the backend container.
	//
	// If we instead string-rewrote the URL after signing, the Host header on
	// the browser's request wouldn't match what the SDK signed over, and
	// SigV4 verification on the bucket would 403.
	presignSource := client
	if cfg.PublicEndpoint != "" {
		if err := validatePublicEndpoint(cfg.PublicEndpoint); err != nil {
			return nil, fmt.Errorf("objectstore: invalid public endpoint: %w", err)
		}
		presignSource = s3.NewFromConfig(loaded, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.PublicEndpoint)
			o.UsePathStyle = cfg.UsePathStyle
		})
	}

	return &S3Store{
		client:    client,
		presigner: s3.NewPresignClient(presignSource),
		bucket:    cfg.Bucket,
	}, nil
}

// validatePublicEndpoint rejects values that don't parse as scheme+host so a
// misconfiguration fails at startup rather than producing broken URLs later.
func validatePublicEndpoint(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("missing scheme or host in %q", raw)
	}
	return nil
}

func (s *S3Store) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	in := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   body,
	}
	if size > 0 {
		in.ContentLength = aws.Int64(size)
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	if _, err := s.client.PutObject(ctx, in); err != nil {
		return fmt.Errorf("s3 put %q: %w", key, err)
	}
	return nil
}

func (s *S3Store) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("s3 presign: ttl must be positive")
	}
	// Cheap existence probe so callers see ErrNotFound rather than a signed
	// URL that 404s when the user clicks it.
	if ok, err := s.Exists(ctx, key); err != nil {
		return "", err
	} else if !ok {
		return "", ErrNotFound
	}
	req, err := s.presigner.PresignGetObject(ctx,
		&s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)},
		s3.WithPresignExpires(ttl),
	)
	if err != nil {
		return "", fmt.Errorf("s3 presign %q: %w", key, err)
	}
	return req.URL, nil
}

// PresignPut mirrors PresignGet but for client-direct uploads. The browser
// PUT must include exactly the Content-Type signed here, or the bucket will
// 403 on signature verification.
func (s *S3Store) PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("s3 presign put: ttl must be positive")
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	req, err := s.presigner.PresignPutObject(ctx, in, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("s3 presign put %q: %w", key, err)
	}
	return req.URL, nil
}

// Stat HEADs the object and returns its size + Content-Type, or ErrNotFound
// when the key is missing. Used to verify client-uploaded objects after a
// PresignPut handshake.
func (s *S3Store) Stat(ctx context.Context, key string) (int64, string, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return 0, "", ErrNotFound
		}
		return 0, "", fmt.Errorf("s3 head %q: %w", key, err)
	}
	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	var ct string
	if out.ContentType != nil {
		ct = *out.ContentType
	}
	return size, ct, nil
}

func (s *S3Store) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil && !isNotFound(err) {
		return fmt.Errorf("s3 delete %q: %w", key, err)
	}
	return nil
}

func (s *S3Store) Exists(ctx context.Context, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err == nil {
		return true, nil
	}
	if isNotFound(err) {
		return false, nil
	}
	return false, fmt.Errorf("s3 head %q: %w", key, err)
}

// isNotFound recognises both the typed NoSuchKey response and the generic
// 404 that HeadObject returns (it doesn't surface NoSuchKey by design).
func isNotFound(err error) bool {
	var nsk *types.NoSuchKey
	if errors.As(err, &nsk) {
		return true
	}
	var nf *types.NotFound
	if errors.As(err, &nf) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound", "404":
			return true
		}
	}
	return false
}
