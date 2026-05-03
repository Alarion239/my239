-- Math Center: the first "club" feature. Each math center represents a single
-- cohort identified by their graduation year (Russian school is 11 years; the
-- grade is derived from current academic year). Groups are sub-divisions of a
-- center. Students belong to a group; teachers belong to a center, optionally
-- as the head teacher.

CREATE TABLE math_centers
(
    id              BIGSERIAL PRIMARY KEY,
    graduation_year INTEGER     NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (graduation_year)
);

CREATE TABLE math_center_groups
(
    id             BIGSERIAL PRIMARY KEY,
    math_center_id BIGINT       NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    name           VARCHAR(50)  NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (math_center_id, name)
);
CREATE INDEX idx_math_center_groups_center ON math_center_groups (math_center_id);

-- One row per (user, group). UNIQUE (user_id) means a user can be a student in
-- exactly one group at a time across all math centers — a deliberate
-- simplification matching how the club operates today.
CREATE TABLE math_center_students
(
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    group_id   BIGINT      NOT NULL REFERENCES math_center_groups (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);
CREATE INDEX idx_math_center_students_group ON math_center_students (group_id);

-- A user can teach multiple math centers, but only one row per (user, center).
-- is_head_teacher gates the "named on the student-facing page" privilege.
CREATE TABLE math_center_teachers
(
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    math_center_id  BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    is_head_teacher BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, math_center_id)
);
CREATE INDEX idx_math_center_teachers_user ON math_center_teachers (user_id);
CREATE INDEX idx_math_center_teachers_center ON math_center_teachers (math_center_id);
