-- Internal teacher-only comments. Two analogous "logs": one anchored to a
-- homework thread (a student's solution of a subproblem — e.g. cheating
-- suspicions about how it was solved), one anchored to a student (the person).
-- Each row is an attributed, timestamped comment; multiple teachers append over
-- time and edit/delete their own. These are NEVER exposed to students — they
-- live only behind teacher-of-center authorization and are never embedded in
-- the student-visible thread timeline.

CREATE TABLE homework_thread_note (
    id             BIGSERIAL   PRIMARY KEY,
    thread_id      BIGINT      NOT NULL REFERENCES homework_thread (id) ON DELETE CASCADE,
    -- RESTRICT mirrors homework_thread_event.actor_user_id: a teacher who has
    -- written notes cannot be hard-deleted out from under them.
    author_user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body           TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_homework_thread_note_thread ON homework_thread_note (thread_id);

CREATE TABLE math_center_student_note (
    id              BIGSERIAL   PRIMARY KEY,
    student_user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Scoped to a center so a teacher only ever sees/writes notes for their own
    -- center, and notes cascade-delete with the center.
    math_center_id  BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    author_user_id  BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body            TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mc_student_note_student
    ON math_center_student_note (student_user_id, math_center_id);
