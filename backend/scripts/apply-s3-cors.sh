#!/usr/bin/env bash
#
# Apply the bucket CORS policy to the Yandex Object Storage bucket so the
# browser can upload (PUT) and download (GET) presigned PDFs directly.
#
# Presigned URLs go browser -> storage.yandexcloud.net, bypassing the backend,
# so CORS must live on the bucket itself. Yandex buckets have NO CORS by default.
#
# Requires the AWS CLI v2 and the same credentials the backend uses.
# Run from anywhere; edit s3-cors.json first if your frontend origin changes.
#
# Usage:
#   export S3_ACCESS_KEY_ID=...        # AWS_ACCESS_KEY_ID also works
#   export S3_SECRET_ACCESS_KEY=...
#   export S3_BUCKET=my239-dev
#   ./apply-s3-cors.sh
#
set -euo pipefail

ENDPOINT="${S3_ENDPOINT:-https://storage.yandexcloud.net}"
REGION="${S3_REGION:-ru-central1}"
BUCKET="${S3_BUCKET:?set S3_BUCKET}"

export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID}}"
export AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY}}"
export AWS_DEFAULT_REGION="$REGION"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Applying CORS to bucket '$BUCKET' at $ENDPOINT ..."
aws --endpoint-url "$ENDPOINT" s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration "file://$DIR/s3-cors.json"

echo "Done. Current CORS:"
aws --endpoint-url "$ENDPOINT" s3api get-bucket-cors --bucket "$BUCKET"
