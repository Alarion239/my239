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
  AND (
      s.term_id = COALESCE(
          (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
          (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
      )
      OR ss.released_at IS NULL
  )
ORDER BY s.number DESC, p.number ASC, sp.label ASC;

-- name: ListCenterCoffinsForTerm :many
-- The active term includes its own released and open coffins plus open coffins
-- carried from every archived term. An archive selection shows only that term.
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
       s.math_center_id           AS math_center_id,
       t.id                       AS term_id,
       t.kind                     AS term_kind,
       t.grade                    AS term_grade
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series s ON s.id = p.series_id
         JOIN math_center_terms t ON t.id = s.term_id
WHERE s.math_center_id = $1
  AND ss.is_coffin = true
  AND (
      s.term_id = $2
      OR (@include_carried::boolean AND ss.released_at IS NULL)
  )
ORDER BY (s.term_id = $2) DESC, s.number DESC, p.number ASC, sp.label ASC;

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
       ss.solution_link                                   AS solution_link,
       ss.solution_group_id                               AS solution_group_id
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
WHERE p.series_id = $1
ORDER BY p.number ASC, sp.label ASC;

-- name: ListSubproblemSolutionsForSeriesIDs :many
-- Batched variant of the above for the series-LIST endpoint, so the list also
-- carries per-subproblem разбор/coffin metadata (one query for all series).
SELECT ss.subproblem_id                                   AS subproblem_id,
       sp.problem_id                                      AS problem_id,
       ss.is_coffin                                       AS is_coffin,
       ss.released_at                                     AS released_at,
       (ss.solution_tex_source IS NOT NULL)::boolean      AS has_solution_tex,
       (ss.solution_pdf_object_key IS NOT NULL)::boolean  AS has_solution_pdf,
       ss.solution_link                                   AS solution_link,
       ss.solution_group_id                               AS solution_group_id
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
WHERE p.series_id = ANY (@series_ids::bigint[])
ORDER BY p.number ASC, sp.label ASC;

-- name: ListCoffinSolvedCounts :many
-- Per-coffin "solved N of M": how many of the center's students have an accepted
-- thread on each coffin subproblem, out of the whole roster.
SELECT ss.subproblem_id                                     AS subproblem_id,
       COUNT(*) FILTER (WHERE t.current_status = 'accepted') AS accepted,
       COUNT(*)                                              AS total
FROM math_center_subproblem_solutions ss
         JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series s ON s.id = p.series_id
         JOIN math_center_groups g ON g.term_id = s.term_id
         JOIN math_center_students mcs ON mcs.group_id = g.id
         LEFT JOIN homework_thread t
                   ON t.subproblem_id = ss.subproblem_id
                  AND t.student_user_id = mcs.user_id
WHERE s.math_center_id = $1
  AND ss.is_coffin = true
GROUP BY ss.subproblem_id;

-- name: ListCoffinQueueForCenter :many
-- Center-wide grading queue for coffins: submissions/appeals on coffin
-- subproblems that aren't locked by another grader. Mirrors the per-series
-- grader queue but spans every series and is filtered to coffins.
SELECT t.id                   AS thread_id,
       t.student_user_id      AS student_user_id,
       t.subproblem_id        AS subproblem_id,
       t.series_id            AS series_id,
       t.current_status       AS current_status,
       t.last_grader_user_id  AS last_grader_user_id,
       t.claim_holder_user_id AS claim_holder_user_id,
       t.claim_expires_at     AS claim_expires_at,
       t.updated_at           AS updated_at,
       u.first_name           AS student_first_name,
       u.middle_name          AS student_middle_name,
       u.last_name            AS student_last_name,
       sp.label               AS subproblem_label,
       p.number               AS problem_number
FROM homework_thread t
         JOIN math_center_subproblem_solutions ss ON ss.subproblem_id = t.subproblem_id AND ss.is_coffin = true
         JOIN users u ON u.id = t.student_user_id
         JOIN math_center_subproblems sp ON sp.id = t.subproblem_id
         JOIN math_center_problems p ON p.id = sp.problem_id
WHERE t.math_center_id = $1
  AND t.current_status IN ('submitted', 'appealed')
  AND (t.claim_holder_user_id IS NULL
       OR t.claim_expires_at < NOW()
       OR t.claim_holder_user_id = @caller_user_id::bigint)
ORDER BY t.current_status ASC, t.updated_at ASC;

-- name: CreateSolutionGroup :one
-- Mint a fresh shared-разбор group id.
INSERT INTO math_center_solution_groups DEFAULT VALUES
RETURNING id;

-- name: SetSubproblemSolutionGroup :exec
-- Assign a (just-minted) group to every subproblem in the set. The solution
-- rows must already exist (content was set first); only existing rows update.
UPDATE math_center_subproblem_solutions
SET solution_group_id = @group_id::bigint,
    updated_at        = NOW()
WHERE subproblem_id = ANY (@subproblem_ids::bigint[]);
