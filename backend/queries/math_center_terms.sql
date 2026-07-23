-- name: ListTermsForCenter :many
SELECT id, math_center_id, kind, grade, is_active, created_at, archived_at
FROM math_center_terms
WHERE math_center_id = $1
ORDER BY is_active DESC, created_at DESC, id DESC;

-- name: GetTerm :one
SELECT id, math_center_id, kind, grade, is_active, created_at, archived_at
FROM math_center_terms
WHERE id = $1;

-- name: GetActiveTermForCenter :one
SELECT id, math_center_id, kind, grade, is_active, created_at, archived_at
FROM math_center_terms
WHERE math_center_id = $1
  AND is_active = TRUE;

-- name: GetLegacyTermForCenter :one
SELECT id, math_center_id, kind, grade, is_active, created_at, archived_at
FROM math_center_terms
WHERE math_center_id = $1
  AND kind = 'legacy';

-- name: ArchiveActiveTermsForCenter :exec
UPDATE math_center_terms
SET is_active = FALSE,
    archived_at = NOW()
WHERE math_center_id = $1
  AND is_active = TRUE;

-- name: CreateMathCenterTerm :one
INSERT INTO math_center_terms (math_center_id, kind, grade, is_active)
VALUES ($1, $2, $3, TRUE)
RETURNING id, math_center_id, kind, grade, is_active, created_at, archived_at;

-- name: CopyGroupsToTerm :exec
INSERT INTO math_center_groups (math_center_id, term_id, name)
SELECT g.math_center_id, $2, g.name
FROM math_center_groups g
WHERE g.term_id = $1
ORDER BY g.name ASC;

-- name: ListGroupsForTerm :many
SELECT *
FROM math_center_groups
WHERE term_id = $1
ORDER BY name ASC;

-- name: CreateMathCenterGroupForTerm :one
INSERT INTO math_center_groups (math_center_id, term_id, name)
SELECT t.math_center_id, t.id, $2
FROM math_center_terms t
WHERE t.id = $1
RETURNING *;

-- name: ListStudentsForTerm :many
SELECT s.id          AS id,
       s.user_id     AS user_id,
       s.group_id    AS group_id,
       s.term_id     AS term_id,
       g.name        AS group_name,
       u.first_name  AS first_name,
       u.middle_name AS middle_name,
       u.last_name   AS last_name
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN users u ON u.id = s.user_id
WHERE s.term_id = $1
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC;

-- name: IsTermActive :one
SELECT is_active
FROM math_center_terms
WHERE id = $1;
