-- Official solutions ("Разбор") + coffin problems ("гробы").
--
-- Series-level разбор: the whole pset's official solutions, shown to students
-- at the series deadline. Stored like the statement — a TeX source and/or a PDF
-- object key — plus an external link that covers video разборы (YouTube/VK) and
-- off-site write-ups we don't host ourselves.
ALTER TABLE math_center_series
    ADD COLUMN solution_tex_source     TEXT,
    ADD COLUMN solution_pdf_object_key TEXT,
    ADD COLUMN solution_link           TEXT;

-- Coffins (гробы): hard problems (typically solved by ≤3 students) that a
-- teacher marks AFTER stats come in. A coffin stays open for submission past
-- the series deadline until its own solution is released (released_at) — which
-- can happen in any later lesson. Each coffin carries its own разбор, separate
-- from the series-level one (the coffin was excluded from the on-time разбор).
--
-- A problem IS a coffin iff a row exists here (UNIQUE problem_id). released_at
-- NULL = still open; set = closed for submission + its solution is available.
CREATE TABLE math_center_coffins
(
    id                      BIGSERIAL PRIMARY KEY,
    problem_id              BIGINT      NOT NULL UNIQUE REFERENCES math_center_problems (id) ON DELETE CASCADE,
    released_at             TIMESTAMPTZ,
    solution_tex_source     TEXT,
    solution_pdf_object_key TEXT,
    solution_link           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_math_center_coffins_problem ON math_center_coffins (problem_id);
