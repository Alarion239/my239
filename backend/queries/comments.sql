-- Internal teacher-only comments. Two analogous resources: thread notes
-- (anchored to a homework_thread) and student notes (anchored to a student in a
-- center). The *Authored variants join users so the handler can return the
-- author's display name without an extra lookup.

-- name: CreateThreadNote :one
INSERT INTO homework_thread_note (thread_id, author_user_id, body)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetThreadNote :one
SELECT * FROM homework_thread_note WHERE id = $1;

-- name: ListThreadNotesAuthored :many
SELECT n.id,
       n.thread_id,
       n.author_user_id,
       u.first_name AS author_first_name,
       u.last_name  AS author_last_name,
       n.body,
       n.created_at,
       n.updated_at
FROM homework_thread_note n
         JOIN users u ON u.id = n.author_user_id
WHERE n.thread_id = $1
ORDER BY n.created_at ASC, n.id ASC;

-- name: GetThreadNoteAuthored :one
SELECT n.id,
       n.thread_id,
       n.author_user_id,
       u.first_name AS author_first_name,
       u.last_name  AS author_last_name,
       n.body,
       n.created_at,
       n.updated_at
FROM homework_thread_note n
         JOIN users u ON u.id = n.author_user_id
WHERE n.id = $1;

-- name: UpdateThreadNote :execrows
UPDATE homework_thread_note
SET body = $2, updated_at = NOW()
WHERE id = $1;

-- name: DeleteThreadNote :execrows
DELETE FROM homework_thread_note WHERE id = $1;

-- name: CreateStudentNote :one
INSERT INTO math_center_student_note (student_user_id, math_center_id, author_user_id, body)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetStudentNote :one
SELECT * FROM math_center_student_note WHERE id = $1;

-- name: ListStudentNotesAuthored :many
SELECT n.id,
       n.student_user_id,
       n.math_center_id,
       n.author_user_id,
       u.first_name AS author_first_name,
       u.last_name  AS author_last_name,
       n.body,
       n.created_at,
       n.updated_at
FROM math_center_student_note n
         JOIN users u ON u.id = n.author_user_id
WHERE n.student_user_id = $1 AND n.math_center_id = $2
ORDER BY n.created_at ASC, n.id ASC;

-- name: GetStudentNoteAuthored :one
SELECT n.id,
       n.student_user_id,
       n.math_center_id,
       n.author_user_id,
       u.first_name AS author_first_name,
       u.last_name  AS author_last_name,
       n.body,
       n.created_at,
       n.updated_at
FROM math_center_student_note n
         JOIN users u ON u.id = n.author_user_id
WHERE n.id = $1;

-- name: UpdateStudentNote :execrows
UPDATE math_center_student_note
SET body = $2, updated_at = NOW()
WHERE id = $1;

-- name: DeleteStudentNote :execrows
DELETE FROM math_center_student_note WHERE id = $1;
