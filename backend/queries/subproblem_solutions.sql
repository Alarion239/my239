-- Per-subproblem official solutions ("Разбор") + coffin state. A row exists iff
-- the subproblem is a coffin OR carries a разбор. See migration 000011.
-- A "coffin" (гроб) is a subproblem kept open for submission past the series
-- deadline until its разбор is released (released_at).

-- name: UpsertCoffinFlag :one
-- Mark/unmark a subproblem as a coffin without disturbing разбор fields.
INSERT INTO math_center_subproblem_solutions (subproblem_id, is_coffin)
VALUES ($1, $2)
ON CONFLICT (subproblem_id)
    DO UPDATE SET is_coffin = EXCLUDED.is_coffin, updated_at = NOW()
RETURNING *;

-- name: GetSubproblemSolution :one
SELECT *
FROM math_center_subproblem_solutions
WHERE subproblem_id = $1;

-- name: DeleteSubproblemSolution :execrows
-- Used when unmarking a coffin that carries no разбор content (clean up the row).
DELETE
FROM math_center_subproblem_solutions
WHERE subproblem_id = $1;

-- name: ReleaseSubproblemSolution :one
-- Stamp released_at (first release wins) — closes a coffin's submission window
-- and makes its разбор available.
UPDATE math_center_subproblem_solutions
SET released_at = COALESCE(released_at, NOW()),
    updated_at  = NOW()
WHERE subproblem_id = $1
RETURNING *;

-- name: SetSubproblemSolutionTex :one
-- Upsert: authoring разбор on a non-coffin subproblem creates the row.
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_tex_source)
VALUES ($1, $2)
ON CONFLICT (subproblem_id)
    DO UPDATE SET solution_tex_source = EXCLUDED.solution_tex_source, updated_at = NOW()
RETURNING *;

-- name: SetSubproblemSolutionPdf :one
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_pdf_object_key)
VALUES ($1, $2)
ON CONFLICT (subproblem_id)
    DO UPDATE SET solution_pdf_object_key = EXCLUDED.solution_pdf_object_key, updated_at = NOW()
RETURNING *;

-- name: SetSubproblemSolutionLink :one
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_link)
VALUES ($1, $2)
ON CONFLICT (subproblem_id)
    DO UPDATE SET solution_link = EXCLUDED.solution_link, updated_at = NOW()
RETURNING *;

-- name: GetSubproblemSolutionCenter :one
-- Resolve a subproblem to its problem + series + center (+ the series deadline),
-- for authorizing coffin/разбор actions and gating student visibility. Returns
-- the row even when no solution row exists yet.
SELECT sp.id            AS subproblem_id,
       sp.label         AS subproblem_label,
       p.id             AS problem_id,
       p.number         AS problem_number,
       s.id             AS series_id,
       s.math_center_id AS math_center_id,
       s.due_at         AS series_due_at
FROM math_center_subproblems sp
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series s ON s.id = p.series_id
WHERE sp.id = $1;

-- name: ListCenterCoffins :many
-- Every coffin subproblem in a center with the labels the Гробы tab needs,
-- newest series first. Used by the center-wide "Гробы" tab.
SELECT ss.subproblem_id           AS subproblem_id,
       ss.is_coffin               AS is_coffin,
       ss.released_at             AS released_at,
       ss.solution_tex_source     AS solution_tex_source,
       ss.solution_pdf_object_key AS solution_pdf_object_key,
       ss.solution_link           AS solution_link,
       ss.created_at              AS created_at,
       sp.label                   AS subproblem_label,
       p.id                       AS problem_id,
       p.number                   AS problem_number,
       s.id                       AS series_id,
       s.number                   AS series_number,
       s.name                     AS series_name,
       s.due_at                   AS series_due_at,
       s.math_center_id           AS math_center_id
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series s ON s.id = p.series_id
WHERE s.math_center_id = $1
  AND ss.is_coffin = true
ORDER BY s.number DESC, p.number ASC, sp.label ASC;

-- name: ListCoffinSubproblemsForStudent :many
-- Each coffin subproblem in a center with the calling student's thread status,
-- so the Гробы tab can render a tile + a "Сдать" link.
SELECT ss.subproblem_id                              AS subproblem_id,
       ss.released_at                                AS released_at,
       sp.label                                      AS subproblem_label,
       p.number                                      AS problem_number,
       COALESCE(t.id, 0)::bigint                     AS thread_id,
       COALESCE(t.current_status, 'ungraded')        AS current_status,
       (t.claim_holder_user_id IS NOT NULL
           AND t.claim_expires_at > now())::boolean  AS being_graded
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series s ON s.id = p.series_id
         LEFT JOIN homework_thread t
                   ON t.subproblem_id = sp.id
                       AND t.student_user_id = @student_user_id::bigint
WHERE s.math_center_id = $1
  AND ss.is_coffin = true
ORDER BY s.number DESC, p.number ASC, sp.label ASC;

-- name: ListSubproblemSolutionsForSeries :many
-- Per-subproblem разбор/coffin metadata for one series, so the teacher Разбор
-- tab and student views can show "has разбор / released / is coffin" per
-- subproblem without N+1 fetches. Only subproblems with a row appear.
SELECT ss.subproblem_id                                   AS subproblem_id,
       sp.problem_id                                      AS problem_id,
       ss.is_coffin                                       AS is_coffin,
       ss.released_at                                     AS released_at,
       (ss.solution_tex_source IS NOT NULL)::boolean      AS has_solution_tex,
       (ss.solution_pdf_object_key IS NOT NULL)::boolean  AS has_solution_pdf,
       ss.solution_link                                   AS solution_link
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
WHERE p.series_id = $1
ORDER BY p.number ASC, sp.label ASC;
