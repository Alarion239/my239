-- Restore the 000010 schema (series-level разбор + problem-keyed coffins). Note:
-- this recreates the SHAPE only; the data dropped by the up migration is gone.
ALTER TABLE math_center_series
    ADD COLUMN solution_tex_source     TEXT,
    ADD COLUMN solution_pdf_object_key TEXT,
    ADD COLUMN solution_link           TEXT;

CREATE TABLE math_center_coffins
(
    id                      BIGSERIAL PRIMARY KEY,
    problem_id              BIGINT      NOT NULL UNIQUE
        REFERENCES math_center_problems (id) ON DELETE CASCADE,
    released_at             TIMESTAMPTZ,
    solution_tex_source     TEXT,
    solution_pdf_object_key TEXT,
    solution_link           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_math_center_coffins_problem ON math_center_coffins (problem_id);

DROP TABLE IF EXISTS math_center_subproblem_solutions;
