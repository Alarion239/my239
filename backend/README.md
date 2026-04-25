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
    handlers/         HTTP handlers (auth, health)
    httpx/            JSON helpers + structured error envelope
    logger/           slog wrapper
    middleware/       auth, CORS, security headers, request logging
    store/            sqlc-generated query code (DO NOT EDIT)
  migrations/         *.up.sql / *.down.sql + embed.FS
  queries/            *.sql consumed by sqlc
  pkg/
    db/               pgxpool wrapper
    migrate/          golang-migrate wrapper
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

## Tests

```sh
go test ./...
go test -race ./...
go test -cover ./...
```

Unit tests use pgxmock (no Postgres required) and miniredis (no Redis required).
