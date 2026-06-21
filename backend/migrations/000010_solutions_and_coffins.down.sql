DROP TABLE IF EXISTS math_center_coffins;

ALTER TABLE math_center_series
    DROP COLUMN IF EXISTS solution_tex_source,
    DROP COLUMN IF EXISTS solution_pdf_object_key,
    DROP COLUMN IF EXISTS solution_link;
