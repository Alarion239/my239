# my239 backend

Go service for the alumni / clubs site.

## Stack

- **Go 1.25** + chi router
- **PostgreSQL 17** via pgx/v5
- **sqlc** for type-safe queries (generates `internal/store` from `queries/*.sql`)
- **golang-migrate** for schema migrations (embedded `migrations/*.sql`)
- **argon2id** for password hashing (OWASP defaults)
- **JWT** access tokens + opaque rotating refresh tokens
- **Redis** for rate limiting (with in-memory fallback)
- **S3-compatible object storage** (Yandex Object Storage in prod, in-memory fallback for dev)

## Layout

```
backend/
  cmd/
    server/           main HTTP server
    migrate/          schema migration CLI
    token-generator/  invitation-token admin CLI
  internal/
    auth/             password hashing, JWT, refresh tokens
    config/           env loading
    ctxcache/         per-request user cache
    handlers/         HTTP handlers (auth, health, admin, mathcenter)
    httpx/            JSON helpers + structured error envelope
    logger/           slog wrapper
    mathcenter/       math center domain helpers (display names, grade, labels)
    middleware/       auth, CORS, security headers, request logging
    store/            sqlc-generated query code (DO NOT EDIT)
  migrations/         *.up.sql / *.down.sql + embed.FS
  queries/            *.sql consumed by sqlc
  pkg/
    db/               pgxpool wrapper
    migrate/          golang-migrate wrapper
    objectstore/      S3-compatible Store interface + Yandex S3Store + MemoryStore
    ratelimit/        memory + redis limiters
  sqlc.yaml           sqlc config
```

## Local development

```sh
docker compose up -d db redis
cp backend/.env.example backend/.env  # edit if needed
cd backend
go run ./cmd/migrate up
go run ./cmd/server
```

## Regenerating database code

After editing any `migrations/*.up.sql` or `queries/*.sql`:

```sh
sqlc generate
```

Files in `internal/store/` are regenerated. Don't edit them by hand.

Install sqlc with:

```sh
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

## Object storage

PDFs (currently: math center series problem sets) live in S3-compatible
object storage. In production we use Yandex Object Storage; locally the
server transparently falls back to an in-process `MemoryStore` so no S3
setup is required for development or tests.

### Configuration

| Env var                    | Default                              | Notes                                          |
| -------------------------- | ------------------------------------ | ---------------------------------------------- |
| `S3_BUCKET`                | (empty → MemoryStore)                | Set this to enable real S3.                    |
| `S3_ACCESS_KEY_ID`         | —                                    | Required when `S3_BUCKET` is set.              |
| `S3_SECRET_ACCESS_KEY`     | —                                    | Required when `S3_BUCKET` is set.              |
| `S3_ENDPOINT`              | `https://storage.yandexcloud.net`    | Override for another S3-compatible endpoint.   |
| `S3_REGION`                | `ru-central1`                        | Yandex's only region.                          |
| `S3_USE_PATH_STYLE`        | `true`                               | Path-style addressing; safest across buckets.  |
| `S3_DOWNLOAD_TTL_MINUTES`  | `15`                                 | Lifetime of presigned download URLs.           |

Startup logs `object store: in-memory (S3_BUCKET not set)` or
`object store: s3 endpoint=… bucket=…` so the active backend is visible.

### Yandex setup (one-time)

1. Cloud console → **Object Storage** → create a bucket; keep ACL **private**.
2. Cloud console → **IAM** → service account with role `storage.editor`.
3. Service account → **Create static access key** → save `key_id` + `secret`
   (the secret is shown once).
4. Set the env vars above and restart the server.

### How the series PDF flow uses it

- Object key is `mathcenter/series/{seriesID}.pdf` — re-upload overwrites in
  place; `DELETE /series/{id}` removes both row and object.
- `POST /api/v1/mathcenter/series/{id}/pdf` accepts a `multipart/form-data`
  upload with a single `file` part, `application/pdf` only, capped at 1 MiB.
- `GET /api/v1/mathcenter/series/{id}/pdf` 302-redirects to a presigned URL.
  Authorization (teacher / student-member) is checked **before** signing, so
  the bucket itself stays private.

### Using `MemoryStore` from Go (e.g. in your own tests)

```go
import "github.com/Alarion239/my239/backend/pkg/objectstore"

store := objectstore.NewMemory()
mcRouter := mcHandlers.Router(database, tokens, store, time.Minute)
```

## Tests

```sh
go test ./...
go test -race ./...
go test -cover ./...
```

Unit tests use pgxmock (no Postgres required) and miniredis (no Redis required).
