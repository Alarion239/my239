DROP INDEX IF EXISTS idx_mc_subproblem_solutions_published_at;
ALTER TABLE math_center_subproblem_solutions
    DROP COLUMN IF EXISTS published_at;
