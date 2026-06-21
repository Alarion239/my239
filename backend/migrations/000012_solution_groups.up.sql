-- Shared «Разбор» groups: when a teacher attaches one source to several
-- subproblems at once, they form a group. Each subproblem still keeps its own
-- solution row (content is copied), but the group id records "these share a
-- разбор", so the student Разбор view can group solutions by the set of
-- problems they cover and light up the whole set on click.
CREATE TABLE math_center_solution_groups
(
    id         BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE math_center_subproblem_solutions
    ADD COLUMN solution_group_id BIGINT
        REFERENCES math_center_solution_groups (id) ON DELETE SET NULL;

CREATE INDEX idx_mc_subproblem_solutions_group
    ON math_center_subproblem_solutions (solution_group_id);
