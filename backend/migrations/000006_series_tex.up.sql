-- Series can now also be authored as a full LaTeX document and rendered
-- in the browser via LaTeX.js. The column is nullable: a series can have
-- only a PDF (legacy), only a TeX source, both (TeX is preferred when
-- displaying), or neither (unpublished draft).
--
-- TEXT is fine here: a typical Russian-babel pset is well under 100 KiB.
-- The handler enforces a 512 KiB cap.
ALTER TABLE math_center_series ADD COLUMN tex_source TEXT;
