-- Coffins ("гробы"): hard problems kept open for submission past the series
-- deadline until their own разбор is released. A problem is a coffin iff a row
-- exists. See migration 000010.

-- name: MarkCoffin :one
-- Idempotent mark: re-marking an existing coffin is a no-op touch.
INSERT INTO math_center_coffins (problem_id)
VALUES ($1)
ON CONFLICT (problem_id) DO UPDATE SET updated_at = NOW()
RETURNING *;

-- name: UnmarkCoffin :execrows
DELETE
FROM math_center_coffins
WHERE problem_id = $1;

-- name: GetCoffin :one
SELECT *
FROM math_center_coffins
WHERE id = $1;

-- name: GetCoffinByProblem :one
SELECT *
FROM math_center_coffins
WHERE problem_id = $1;

-- name: GetCoffinCenter :one
-- Resolve a coffin to its problem + center, for authorizing release/solution.
SELECT c.id             AS coffin_id,
       c.problem_id     AS problem_id,
       s.math_center_id AS math_center_id
FROM math_center_coffins c
         JOIN math_center_problems p ON p.id = c.problem_id
         JOIN math_center_series s ON s.id = p.series_id
WHERE c.id = $1;

-- name: ReleaseCoffin :one
-- Stamps released_at (first release wins) — closes submission + makes the
-- coffin's solution available.
UPDATE math_center_coffins
SET released_at = COALESCE(released_at, NOW()),
    updated_at  = NOW()
WHERE id = $1
RETURNING *;

-- name: SetCoffinSolutionTex :one
UPDATE math_center_coffins
SET solution_tex_source = $2,
    updated_at          = NOW()
WHERE id = $1
RETURNING *;

-- name: SetCoffinSolutionPdf :one
UPDATE math_center_coffins
SET solution_pdf_object_key = $2,
    updated_at              = NOW()
WHERE id = $1
RETURNING *;

-- name: SetCoffinSolutionLink :one
UPDATE math_center_coffins
SET solution_link = $2,
    updated_at    = NOW()
WHERE id = $1
RETURNING *;

-- name: ListCoffinSubproblemsForStudent :many
-- For every coffin in a center, the problem's subproblems with the calling
-- student's thread status — so the Гробы tab can show tiles + a "Сдать" link.
SELECT c.id            AS coffin_id,
       sp.id           AS subproblem_id,
       sp.label        AS subproblem_label,
       COALESCE(t.id, 0)::bigint              AS thread_id,
       COALESCE(t.current_status, 'ungraded') AS current_status,
       (t.claim_holder_user_id IS NOT NULL
            AND t.claim_expires_at > now())::boolean AS being_graded
FROM math_center_coffins c
         JOIN math_center_problems p ON p.id = c.problem_id
         JOIN math_center_series s ON s.id = p.series_id
         JOIN math_center_subproblems sp ON sp.problem_id = p.id
         LEFT JOIN homework_thread t
                   ON t.subproblem_id = sp.id
                  AND t.student_user_id = @student_user_id::bigint
WHERE s.math_center_id = $1
ORDER BY p.number ASC, sp.label ASC;

-- name: ListCenterCoffins :many
-- Every coffin in a center with the labels the UI needs (series + problem),
-- newest series first. Used by the center-wide "Гробы" tab.
SELECT c.id                      AS id,
       c.problem_id              AS problem_id,
       c.released_at             AS released_at,
       c.solution_tex_source     AS solution_tex_source,
       c.solution_pdf_object_key AS solution_pdf_object_key,
       c.solution_link           AS solution_link,
       c.created_at              AS created_at,
       p.number                  AS problem_number,
       s.id                      AS series_id,
       s.number                  AS series_number,
       s.name                    AS series_name,
       s.math_center_id          AS math_center_id
FROM math_center_coffins c
         JOIN math_center_problems p ON p.id = c.problem_id
         JOIN math_center_series s ON s.id = p.series_id
WHERE s.math_center_id = $1
ORDER BY s.number DESC, p.number ASC;
