-- Per-student, per-series razbor access. Missing rows inherit the enrollment's
-- default (currently open), so deploying this table changes nobody's access.
CREATE TABLE math_center_student_series_razbor_access
(
    student_user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    series_id       BIGINT      NOT NULL REFERENCES math_center_series (id) ON DELETE CASCADE,
    can_view_video  BOOLEAN     NOT NULL DEFAULT TRUE,
    can_view_pdf_tex BOOLEAN    NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_user_id, series_id)
);

CREATE INDEX idx_mc_student_series_razbor_access_series
    ON math_center_student_series_razbor_access (series_id, student_user_id);
