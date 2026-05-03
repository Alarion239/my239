-- Series = a problem set in a math center, named "Серия {Number}. {Name}".
-- pdf_object_key + published_at are the "is this published" toggle: both NULL
-- means draft (teachers see it, students don't); both set means published.
-- We never expose the raw key to clients — the download handler signs a URL.
CREATE TABLE math_center_series
(
    id             BIGSERIAL PRIMARY KEY,
    math_center_id BIGINT       NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    number         INTEGER      NOT NULL,
    name           TEXT         NOT NULL,
    due_at         TIMESTAMPTZ  NOT NULL,
    pdf_object_key TEXT,
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (math_center_id, number)
);
CREATE INDEX idx_math_center_series_center ON math_center_series (math_center_id);

-- Problems within a series. number = 0 is the "Упражнение" warm-up, 1+ are
-- regular задачи. UNIQUE (series_id, number) keeps the list well-formed.
CREATE TABLE math_center_problems
(
    id        BIGSERIAL PRIMARY KEY,
    series_id BIGINT      NOT NULL REFERENCES math_center_series (id) ON DELETE CASCADE,
    number    INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (series_id, number)
);
CREATE INDEX idx_math_center_problems_series ON math_center_problems (series_id);

-- Subproblems hang off a problem with a single Latin letter label (a, b, c…).
-- Modeled as a row-per-subproblem so future submission/grading rows can FK
-- into a stable id rather than a (problem_id, label) composite.
CREATE TABLE math_center_subproblems
(
    id         BIGSERIAL PRIMARY KEY,
    problem_id BIGINT      NOT NULL REFERENCES math_center_problems (id) ON DELETE CASCADE,
    label      VARCHAR(8)  NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (problem_id, label)
);
CREATE INDEX idx_math_center_subproblems_problem ON math_center_subproblems (problem_id);
