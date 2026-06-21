-- name: CreateSeries :one
INSERT INTO math_center_series (math_center_id, number, name, due_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetSeries :one
SELECT *
FROM math_center_series
WHERE id = $1;

-- name: ListSeriesForCenter :many
SELECT *
FROM math_center_series
WHERE math_center_id = $1
ORDER BY number ASC;

-- name: ListPublishedSeriesForCenter :many
SELECT *
FROM math_center_series
WHERE math_center_id = $1
  AND published_at IS NOT NULL
ORDER BY number ASC;

-- name: UpdateSeries :one
UPDATE math_center_series
SET number = $2,
    name   = $3,
    due_at = $4
WHERE id = $1
RETURNING *;

-- name: PublishSeries :one
-- Sets the PDF object key and stamps published_at to NOW(). Used both for
-- first-time publishing and re-uploads (we just overwrite; the caller is
-- responsible for deleting the prior key first if needed).
UPDATE math_center_series
SET pdf_object_key = $2,
    published_at   = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteSeries :execrows
DELETE
FROM math_center_series
WHERE id = $1;

-- name: SetSeriesTex :one
-- Stores or replaces the raw LaTeX source. Also stamps published_at if
-- the series wasn't already published, mirroring the PDF publish flow:
-- a series with any rendered content is considered visible to students.
UPDATE math_center_series
SET tex_source  = $2,
    published_at = COALESCE(published_at, NOW())
WHERE id = $1
RETURNING *;

-- name: ClearSeriesTex :one
UPDATE math_center_series
SET tex_source = NULL
WHERE id = $1
RETURNING *;

-- name: GetSeriesTex :one
SELECT tex_source
FROM math_center_series
WHERE id = $1;

-- name: SetSeriesSolutionTex :one
-- Stores/replaces the series-level разбор LaTeX. Does NOT touch published_at:
-- разбор visibility is gated on due_at, not publication.
UPDATE math_center_series
SET solution_tex_source = $2
WHERE id = $1
RETURNING *;

-- name: ClearSeriesSolutionTex :one
UPDATE math_center_series
SET solution_tex_source = NULL
WHERE id = $1
RETURNING *;

-- name: GetSeriesSolutionTex :one
SELECT solution_tex_source
FROM math_center_series
WHERE id = $1;

-- name: SetSeriesSolutionPdf :one
-- $2 = object key (set) or NULL (clear after a best-effort blob delete).
UPDATE math_center_series
SET solution_pdf_object_key = $2
WHERE id = $1
RETURNING *;

-- name: SetSeriesSolutionLink :one
-- $2 = external/video link (set) or NULL (clear).
UPDATE math_center_series
SET solution_link = $2
WHERE id = $1
RETURNING *;

-- name: CreateProblem :one
INSERT INTO math_center_problems (series_id, number)
VALUES ($1, $2)
RETURNING *;

-- name: GetProblemCenter :one
-- Resolve a problem to its series + center, for authorizing coffin actions.
SELECT p.id             AS problem_id,
       s.id             AS series_id,
       s.math_center_id AS math_center_id
FROM math_center_problems p
         JOIN math_center_series s ON s.id = p.series_id
WHERE p.id = $1;

-- name: ListProblemsForSeries :many
SELECT *
FROM math_center_problems
WHERE series_id = $1
ORDER BY number ASC;

-- name: DeleteProblemsForSeries :exec
DELETE
FROM math_center_problems
WHERE series_id = $1;

-- name: CreateSubproblem :one
INSERT INTO math_center_subproblems (problem_id, label)
VALUES ($1, $2)
RETURNING *;

-- name: ListSubproblemsForSeries :many
SELECT s.id        AS id,
       s.problem_id AS problem_id,
       s.label     AS label
FROM math_center_subproblems s
         JOIN math_center_problems p ON p.id = s.problem_id
WHERE p.series_id = $1
ORDER BY p.number ASC, s.label ASC;

-- name: IsTeacherInCenter :one
SELECT EXISTS (
    SELECT 1
    FROM math_center_teachers
    WHERE user_id = $1
      AND math_center_id = $2
) AS is_teacher;

-- name: IsStudentInCenter :one
SELECT EXISTS (
    SELECT 1
    FROM math_center_students s
             JOIN math_center_groups g ON g.id = s.group_id
    WHERE s.user_id = $1
      AND g.math_center_id = $2
) AS is_student;

-- name: ListProblemsForSeriesIDs :many
SELECT *
FROM math_center_problems
WHERE series_id = ANY(@series_ids::bigint[])
ORDER BY series_id ASC, number ASC;

-- name: ListSubproblemsForSeriesIDs :many
SELECT s.id         AS id,
       s.problem_id AS problem_id,
       s.label      AS label
FROM math_center_subproblems s
         JOIN math_center_problems p ON p.id = s.problem_id
WHERE p.series_id = ANY(@series_ids::bigint[])
ORDER BY p.number ASC, s.label ASC;
