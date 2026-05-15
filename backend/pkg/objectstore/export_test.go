package objectstore

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// PresignGetForTest exposes the presigner directly without the production
// existence probe — tests don't have a real bucket to HEAD. The shape of the
// emitted URL (host, signature query) is what we care about; that's set by
// the presign client's configuration, not by whether the object exists.
func (s *S3Store) PresignGetForTest(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := s.presigner.PresignGetObject(ctx,
		&s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)},
		s3.WithPresignExpires(ttl),
	)
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
