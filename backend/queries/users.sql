-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;

-- name: GetUserByUsername :one
SELECT *
FROM users
WHERE username = $1;

-- name: CreateUser :one
INSERT INTO users (username, password_hash, first_name, middle_name, last_name, invitation_token_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: CountUsesOfInvitationToken :one
SELECT COUNT(*)
FROM users
WHERE invitation_token_id = $1;
