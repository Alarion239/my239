ALTER TABLE math_center_students
    DROP COLUMN IF EXISTS razbor_default_video,
    DROP COLUMN IF EXISTS razbor_default_pdf_tex;

ALTER TABLE math_center_groups
    DROP COLUMN IF EXISTS razbor_default_video,
    DROP COLUMN IF EXISTS razbor_default_pdf_tex;
