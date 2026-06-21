-- name: GetInvitationTokenByValue :one
SELECT *
FROM invitation_tokens
WHERE token = $1;

-- name: GetInvitationTokenByValueForUpdate :one
SELECT *
FROM invitation_tokens
WHERE token = $1 FOR UPDATE;

-- name: CreateInvitationToken :one
INSERT INTO invitation_tokens (token, description, max_uses, expires_at, preset, math_center_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: ListInvitationTokens :many
SELECT *
FROM invitation_tokens
ORDER BY created_at DESC;

-- name: ListInvitationTokensForCenter :many
SELECT *
FROM invitation_tokens
WHERE math_center_id = $1
ORDER BY created_at DESC;

-- name: GetInvitationTokenByID :one
SELECT *
FROM invitation_tokens
WHERE id = $1;

-- name: RevokeInvitationTokenByValue :execrows
UPDATE invitation_tokens
SET expires_at = NOW()
WHERE token = $1;

-- name: RevokeInvitationTokenByID :execrows
UPDATE invitation_tokens
SET expires_at = NOW()
WHERE id = $1;
