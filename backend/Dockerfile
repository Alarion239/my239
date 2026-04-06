# ---- build stage ----
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Download deps first (cached layer as long as go.mod/go.sum don't change)
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build all three binaries
COPY . .
RUN go build -o server        ./cmd/server       && \
    go build -o migrate       ./cmd/migrate      && \
    go build -o token-generator ./cmd/token-generator

# ---- runtime stage ----
FROM alpine:latest

WORKDIR /app

# Copy binaries and migration SQL files
COPY --from=builder /app/server          ./server
COPY --from=builder /app/migrate         ./migrate
COPY --from=builder /app/token-generator ./token-generator
COPY --from=builder /app/migrations      ./migrations

# Run as a non-root user
RUN adduser -D appuser
USER appuser

EXPOSE 8080

# Run pending migrations then start the server (same as railway.toml today)
CMD ["sh", "-c", "./migrate up && ./server"]
