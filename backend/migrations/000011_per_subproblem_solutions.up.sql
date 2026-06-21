-- Per-subproblem official solutions ("Разбор") + coffins ("гробы").
--
-- The subproblem is the atomic unit: each subproblem has its OWN разбор and its
-- OWN release timing. A "coffin" (гроб) is simply a subproblem kept OPEN for
-- submission past the series deadline until its разбор is released. This
-- replaces BOTH the series-level разбор columns and the problem-keyed
-- math_center_coffins table from migration 000010.
--
-- A row exists iff the subproblem is a coffin OR carries a разбор. released_at
-- is meaningful only for coffins (the deferred release); normal subproblems use
-- the series deadline. NULL released_at = a coffin still open.
CREATE TABLE math_center_subproblem_solutions
(
    id                      BIGSERIAL PRIMARY KEY,
    subproblem_id           BIGINT      NOT NULL UNIQUE
        REFERENCES math_center_subproblems (id) ON DELETE CASCADE,
    is_coffin               BOOLEAN     NOT NULL DEFAULT false,
    released_at             TIMESTAMPTZ,
    solution_tex_source     TEXT,
    solution_pdf_object_key TEXT,
    solution_link           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mc_subproblem_solutions_subproblem
    ON math_center_subproblem_solutions (subproblem_id);

-- Existing coffin rows key on problem_id and cannot be auto-mapped to a single
-- subproblem (a problem has many). This is dev data — drop it. (The down
-- migration restores the SCHEMA only, not the data.)
DROP TABLE IF EXISTS math_center_coffins;

-- Series-level разбор is gone; replaced by the per-subproblem table above.
ALTER TABLE math_center_series
    DROP COLUMN IF EXISTS solution_tex_source,
    DROP COLUMN IF EXISTS solution_pdf_object_key,
    DROP COLUMN IF EXISTS solution_link;
