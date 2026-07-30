-- A posted разбор now releases its coffin in the same database write. Bring
-- legacy rows that already have content into that invariant so no coffin is
-- stranded without the retired manual close control.
UPDATE math_center_subproblem_solutions
SET released_at = updated_at
WHERE is_coffin
  AND released_at IS NULL
  AND (
    solution_tex_source IS NOT NULL
    OR solution_pdf_object_key IS NOT NULL
    OR solution_link IS NOT NULL
  );
