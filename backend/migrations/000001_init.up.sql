-- Single initial migration. We're at the start of the project — no historical
-- data to preserve, so the schema is consolidated into one file. Future
-- changes go in 000002_..., 000003_..., etc.

-- Invitation tokens are issued by an admin (via the token-generator CLI) and
-- are required to register. Each token has a usage count cap and an expiry.
CREATE TABLE invitation_tokens
(
    id          BIGSERIAL PRIMARY KEY,
    token       VARCHAR(255) UNIQUE NOT NULL,
    description VARCHAR(255)        NOT NULL,
    max_uses    INTEGER             NOT NULL CHECK (max_uses > 0),
    expires_at  TIMESTAMPTZ         NOT NULL,
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Application users. password_hash holds an argon2id-encoded string
-- ($argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>) — TEXT because the encoded
-- length depends on parameter choices and is not bounded by VARCHAR.
CREATE TABLE users
(
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(50) UNIQUE NOT NULL,
    password_hash       TEXT               NOT NULL,
    first_name          VARCHAR(255)       NOT NULL,
    middle_name         VARCHAR(255),
    last_name           VARCHAR(255)       NOT NULL DEFAULT '',
    invitation_token_id BIGINT             NOT NULL REFERENCES invitation_tokens (id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_invitation_token_id ON users (invitation_token_id);

-- Refresh tokens are stored as SHA-256 hashes (BYTEA, fixed 32 bytes) — a
-- DB leak cannot be used to mint access tokens. Rotation: when a refresh
-- token is exchanged, the old row gets revoked_at + replaced_by_id set,
-- forming a chain that's auditable but never reusable.
CREATE TABLE refresh_tokens
(
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash     BYTEA UNIQUE NOT NULL,
    expires_at     TIMESTAMPTZ  NOT NULL,
    revoked_at     TIMESTAMPTZ,
    replaced_by_id BIGINT       REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
