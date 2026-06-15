-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;

-- name: GetUsersByIDs :many
-- Bulk lookup used by the homework thread view: it needs to translate
-- every user_id on the page (student, last grader, claim holder, every
-- event's actor) into a display name. ANY(array) is one round-trip vs
-- N+1 GetUserByID calls.
SELECT id, first_name, middle_name, last_name
FROM users
WHERE id = ANY (@ids::bigint[]);

-- name: GetUserByUsername :one
SELECT *
FROM users
WHERE username = $1;

-- name: CreateUser :one
INSERT INTO users (username, password_hash, first_name, middle_name, last_name, invitation_token_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: CreateMathCenterAccount :one
-- Creates a shared, admin-provisioned MathCenter login. These accounts carry no
-- invitation lineage (invitation_token_id stays NULL) and are flagged so the UI
-- can distinguish them. The caller enrolls the returned user as a head teacher
-- of the target center in the same transaction.
INSERT INTO users (username, password_hash, first_name, middle_name, last_name, is_math_center)
VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *;

-- name: CountUsesOfInvitationToken :one
-- The cast keeps the parameter a plain int64: invitation_token_id is nullable
-- on the column (MathCenter accounts have none), but callers always count a
-- concrete token here.
SELECT COUNT(*)
FROM users
WHERE invitation_token_id = sqlc.arg(token_id)::bigint;

-- name: ListUsers :many
SELECT *
FROM users
ORDER BY created_at DESC;

-- name: SetUserAdmin :exec
UPDATE users
SET is_admin   = $2,
    updated_at = NOW()
WHERE id = $1;
