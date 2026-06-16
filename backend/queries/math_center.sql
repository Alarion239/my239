-- name: CreateMathCenter :one
INSERT INTO math_centers (graduation_year)
VALUES ($1)
RETURNING *;

-- name: ListMathCenters :many
SELECT *
FROM math_centers
ORDER BY graduation_year ASC;

-- name: GetMathCenter :one
SELECT *
FROM math_centers
WHERE id = $1;

-- name: DeleteMathCenter :execrows
DELETE
FROM math_centers
WHERE id = $1;

-- name: CreateMathCenterGroup :one
INSERT INTO math_center_groups (math_center_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: ListGroupsForCenter :many
SELECT *
FROM math_center_groups
WHERE math_center_id = $1
ORDER BY name ASC;

-- name: GetGroup :one
SELECT *
FROM math_center_groups
WHERE id = $1;

-- name: DeleteMathCenterGroup :execrows
DELETE
FROM math_center_groups
WHERE id = $1;

-- name: AddStudentToGroup :one
INSERT INTO math_center_students (user_id, group_id)
VALUES ($1, $2)
RETURNING *;

-- name: GetStudentByUserID :one
SELECT s.id          AS id,
       s.user_id     AS user_id,
       s.group_id    AS group_id,
       g.name        AS group_name,
       g.math_center_id AS math_center_id,
       mc.graduation_year AS graduation_year
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN math_centers mc ON mc.id = g.math_center_id
WHERE s.user_id = $1;

-- name: ListStudentsForCenter :many
SELECT s.id        AS id,
       s.user_id   AS user_id,
       s.group_id  AS group_id,
       g.name      AS group_name,
       u.first_name AS first_name,
       u.middle_name AS middle_name,
       u.last_name AS last_name
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN users u ON u.id = s.user_id
WHERE g.math_center_id = $1
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC;

-- name: RemoveStudent :execrows
DELETE
FROM math_center_students
WHERE id = $1;

-- name: AddTeacherToCenter :one
INSERT INTO math_center_teachers (user_id, math_center_id, is_head_teacher)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListTeachersForCenter :many
SELECT t.id              AS id,
       t.user_id         AS user_id,
       t.math_center_id  AS math_center_id,
       t.is_head_teacher AS is_head_teacher,
       u.first_name      AS first_name,
       u.middle_name     AS middle_name,
       u.last_name       AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = $1
ORDER BY t.is_head_teacher DESC, u.last_name ASC, u.first_name ASC;

-- name: ListCentersForTeacher :many
SELECT mc.id                AS id,
       mc.graduation_year   AS graduation_year,
       t.is_head_teacher    AS is_head_teacher
FROM math_center_teachers t
         JOIN math_centers mc ON mc.id = t.math_center_id
WHERE t.user_id = $1
ORDER BY mc.graduation_year ASC;

-- name: SetTeacherHead :execrows
UPDATE math_center_teachers
SET is_head_teacher = $2
WHERE id = $1;

-- name: RemoveTeacher :execrows
DELETE
FROM math_center_teachers
WHERE id = $1;

-- name: ListHeadTeachersForCenter :many
SELECT t.id          AS id,
       t.user_id     AS user_id,
       u.first_name  AS first_name,
       u.middle_name AS middle_name,
       u.last_name   AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = $1
  AND t.is_head_teacher = TRUE
ORDER BY u.last_name ASC, u.first_name ASC;

-- name: ListTeachersForCenters :many
SELECT t.id              AS id,
       t.user_id         AS user_id,
       t.math_center_id  AS math_center_id,
       t.is_head_teacher AS is_head_teacher,
       u.first_name      AS first_name,
       u.middle_name     AS middle_name,
       u.last_name       AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = ANY(@center_ids::bigint[])
ORDER BY t.math_center_id ASC, t.is_head_teacher DESC, u.last_name ASC, u.first_name ASC;

-- name: ListGroupsForCenters :many
SELECT *
FROM math_center_groups
WHERE math_center_id = ANY(@center_ids::bigint[])
ORDER BY math_center_id ASC, name ASC;

-- name: ListStudentsForCenters :many
SELECT s.id            AS id,
       s.user_id       AS user_id,
       s.group_id      AS group_id,
       g.name          AS group_name,
       g.math_center_id AS math_center_id,
       u.first_name    AS first_name,
       u.middle_name   AS middle_name,
       u.last_name     AS last_name
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN users u ON u.id = s.user_id
WHERE g.math_center_id = ANY(@center_ids::bigint[])
ORDER BY g.math_center_id ASC, g.name ASC, u.last_name ASC, u.first_name ASC;
