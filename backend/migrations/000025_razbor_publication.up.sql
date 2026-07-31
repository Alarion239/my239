-- Razbor materials are saved as drafts and become student-visible only after
-- an explicit publication action. Existing materials are backfilled as
-- published so the migration does not change current access.
ALTER TABLE math_center_subproblem_solutions
    ADD COLUMN published_at TIMESTAMPTZ;

UPDATE math_center_subproblem_solutions
SET published_at = COALESCE(updated_at, created_at, NOW())
WHERE solution_tex_source IS NOT NULL
   OR solution_pdf_object_key IS NOT NULL
   OR solution_link IS NOT NULL;

CREATE INDEX idx_mc_subproblem_solutions_published_at
    ON math_center_subproblem_solutions (published_at);
