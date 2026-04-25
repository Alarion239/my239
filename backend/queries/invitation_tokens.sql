-- name: GetInvitationTokenByValue :one
SELECT *
FROM invitation_tokens
WHERE token = $1;

-- name: GetInvitationTokenByValueForUpdate :one
SELECT *
FROM invitation_tokens
WHERE token = $1 FOR UPDATE;

-- name: CreateInvitationToken :one
INSERT INTO invitation_tokens (token, description, max_uses, expires_at)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListInvitationTokens :many
SELECT *
FROM invitation_tokens
ORDER BY created_at DESC;

-- name: RevokeInvitationTokenByValue :execrows
UPDATE invitation_tokens
SET expires_at = NOW()
WHERE token = $1;

-- name: RevokeInvitationTokenByID :execrows
UPDATE invitation_tokens
SET expires_at = NOW()
WHERE id = $1;
