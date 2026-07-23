-- name: CreateSeries :one
INSERT INTO math_center_series (math_center_id, term_id, number, name, due_at)
SELECT $1, id, $2, $3, $4
FROM math_center_terms
WHERE math_center_id = $1
  AND is_active = TRUE
RETURNING id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

-- name: CreateSeriesInTerm :one
INSERT INTO math_center_series (math_center_id, term_id, number, name, due_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, math_center_id, term_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

-- name: GetSeries :one
-- Keep the long-standing row shape for the high-traffic series detail path.
-- Term-aware list/create endpoints carry term_id; callers that only resolve a
-- series id do not need it and existing homework mocks retain their contract.
SELECT id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source
FROM math_center_series
WHERE id = $1;

-- name: ListSeriesForCenter :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT s.id, s.math_center_id, s.number, s.name, s.due_at, s.pdf_object_key, s.published_at, s.created_at, s.tex_source
FROM math_center_series s
WHERE s.math_center_id = $1
  AND s.term_id = (SELECT id FROM selected_term)
ORDER BY number ASC;

-- name: ListSeriesForTerm :many
SELECT *
FROM math_center_series
WHERE math_center_id = $1
  AND term_id = $2
ORDER BY number ASC;

-- name: ListPublishedSeriesForCenter :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT s.id, s.math_center_id, s.number, s.name, s.due_at, s.pdf_object_key, s.published_at, s.created_at, s.tex_source
FROM math_center_series s
WHERE s.math_center_id = $1
  AND s.term_id = (SELECT id FROM selected_term)
  AND s.published_at IS NOT NULL
ORDER BY number ASC;

-- name: ListPublishedSeriesForTerm :many
SELECT *
FROM math_center_series
WHERE math_center_id = $1
  AND term_id = $2
  AND published_at IS NOT NULL
ORDER BY number ASC;

-- name: UpdateSeries :one
UPDATE math_center_series
SET number = $2,
    name   = $3,
    due_at = $4
WHERE id = $1
RETURNING id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

-- name: PublishSeries :one
-- Sets the PDF object key and stamps published_at to NOW(). Used both for
-- first-time publishing and re-uploads (we just overwrite; the caller is
-- responsible for deleting the prior key first if needed).
UPDATE math_center_series
SET pdf_object_key = $2,
    published_at   = NOW()
WHERE id = $1
RETURNING id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

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
RETURNING id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

-- name: ClearSeriesTex :one
UPDATE math_center_series
SET tex_source = NULL
WHERE id = $1
RETURNING id, math_center_id, number, name, due_at, pdf_object_key, published_at, created_at, tex_source;

-- name: GetSeriesTex :one
SELECT tex_source
FROM math_center_series
WHERE id = $1;

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

-- name: SetProblemNumber :exec
-- Renumber a problem in place (used by the diff-based series update so existing
-- problems keep their id — and thus their subproblems/threads/разборы/coffins).
UPDATE math_center_problems
SET number = $2
WHERE id = $1;

-- name: DeleteProblem :exec
-- Delete one problem (cascades to its subproblems → threads/solutions). Used by
-- the diff update when a teacher removes a problem.
DELETE
FROM math_center_problems
WHERE id = $1;

-- name: DeleteSubproblem :exec
-- Delete one subproblem (cascades to its thread/solution). Used by the diff
-- update when a problem's subparts shrink.
DELETE
FROM math_center_subproblems
WHERE id = $1;

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
         JOIN math_center_terms t ON t.id = s.term_id
    WHERE s.user_id = $1
      AND g.math_center_id = $2
      AND (
          t.is_active = TRUE
          OR NOT EXISTS (
              SELECT 1
              FROM math_center_terms active
              WHERE active.math_center_id = $2
                AND active.is_active = TRUE
          )
      )
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
