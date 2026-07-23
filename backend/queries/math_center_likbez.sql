-- name: LockMathCenterForLikbezNumbering :one
-- Serializes automatic per-center numbering without an application-level lock.
SELECT id
FROM math_centers
WHERE id = $1
FOR UPDATE;

-- name: NextLikbezNumber :one
SELECT COALESCE(MAX(number), 0)::integer + 1 AS number
FROM math_center_likbez
WHERE math_center_id = $1;

-- name: CreateLikbez :one
INSERT INTO math_center_likbez (math_center_id, term_id, number, title, held_on, description)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetLikbez :one
SELECT l.*, t.kind AS term_kind, t.grade AS term_grade
FROM math_center_likbez l
         JOIN math_center_terms t ON t.id = l.term_id
WHERE l.id = $1;

-- name: ListLikbezForCenter :many
SELECT l.*, t.kind AS term_kind, t.grade AS term_grade
FROM math_center_likbez l
         JOIN math_center_terms t ON t.id = l.term_id
WHERE l.math_center_id = $1
ORDER BY l.number DESC;

-- name: ListPublishedLikbezForCenter :many
SELECT l.*, t.kind AS term_kind, t.grade AS term_grade
FROM math_center_likbez l
         JOIN math_center_terms t ON t.id = l.term_id
WHERE l.math_center_id = $1
  AND l.published_at IS NOT NULL
ORDER BY l.number DESC;

-- name: UpdateLikbez :one
UPDATE math_center_likbez
SET term_id = $2,
    number = $3,
    title = $4,
    held_on = $5,
    description = $6,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteLikbez :execrows
DELETE FROM math_center_likbez
WHERE id = $1;

-- name: SetLikbezPDF :one
UPDATE math_center_likbez
SET pdf_object_key = $2,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: SetLikbezTex :one
UPDATE math_center_likbez
SET tex_source = $2,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: SetLikbezVideoURL :one
UPDATE math_center_likbez
SET video_url = $2,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: PublishLikbez :one
UPDATE math_center_likbez
SET published_at = COALESCE(published_at, NOW()),
    updated_at = NOW()
WHERE id = $1
  AND (pdf_object_key IS NOT NULL OR tex_source IS NOT NULL OR video_url IS NOT NULL)
RETURNING *;

-- name: UnpublishLikbez :one
UPDATE math_center_likbez
SET published_at = NULL,
    updated_at = NOW()
WHERE id = $1
RETURNING *;
