-- Format-specific defaults for the management matrix. Student defaults are
-- copied from the group when a student is enrolled and can then be adjusted
-- independently.
ALTER TABLE math_center_groups
    ADD COLUMN razbor_default_video   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN razbor_default_pdf_tex BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE math_center_students
    ADD COLUMN razbor_default_video   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN razbor_default_pdf_tex BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE math_center_students
SET razbor_default_video = can_view_razbors,
    razbor_default_pdf_tex = can_view_razbors;

-- Materialize the effective value for every existing enrollment/series pair so
-- changing a future-series default cannot change historical access.
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       student.razbor_default_video,
       student.razbor_default_pdf_tex
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
ON CONFLICT (student_user_id, series_id) DO NOTHING;
