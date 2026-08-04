-- Teacher-only background colors for student names. The row is center-scoped
-- so it survives term rollover while remaining invisible outside teacher APIs.
CREATE TABLE math_center_student_name_color
(
    math_center_id  BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    student_user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    background_hex  TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (math_center_id, student_user_id),
    CONSTRAINT student_name_color_hex_format
        CHECK (background_hex ~ '^#[0-9A-F]{6}$')
);

CREATE INDEX idx_student_name_color_student
    ON math_center_student_name_color (student_user_id);
