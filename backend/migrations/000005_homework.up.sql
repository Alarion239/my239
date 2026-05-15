-- Homework: per-(student, subproblem) submission/grading threads, modeled as
-- a cached "current state" row + append-only event log.
--
-- Why two tables: the event log is the source of truth for full history
-- (every attempt, every grade, every appeal stays on the timeline), and the
-- cache columns on homework_thread let queue/rollup queries stay cheap. The
-- cache is kept in sync with the events inside the same transaction by the
-- homework handlers.
--
-- The unit of grading is math_center_subproblems.id. Problems with no real
-- subparts carry a single sentinel subproblem (label = '') created by the
-- series handler / backfilled below, so this column is always non-null and
-- a plain UNIQUE (student, subproblem) is enough.

-- Backfill sentinel subproblems for any existing zero-subpart problem. After
-- this, every math_center_problems row has at least one math_center_subproblems
-- row; the series handler does the same for new rows going forward.
INSERT INTO math_center_subproblems (problem_id, label)
SELECT p.id, ''
FROM math_center_problems p
         LEFT JOIN math_center_subproblems s ON s.problem_id = p.id
WHERE s.id IS NULL;

CREATE TABLE homework_thread
(
    id                       BIGSERIAL PRIMARY KEY,
    student_user_id          BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    subproblem_id            BIGINT      NOT NULL REFERENCES math_center_subproblems (id) ON DELETE CASCADE,
    series_id                BIGINT      NOT NULL REFERENCES math_center_series (id) ON DELETE CASCADE,
    math_center_id           BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,

    -- Denormalized "what's the user-visible state right now". Updated in the
    -- same tx as each event insert. Valid transitions enforced in Go.
    current_status           TEXT        NOT NULL DEFAULT 'ungraded'
        CHECK (current_status IN ('ungraded', 'submitted', 'accepted', 'rejected', 'appealed')),
    current_attempt_event_id BIGINT,     -- latest 'submitted' or 'appealed' event
    current_grade_event_id   BIGINT,     -- latest 'graded' event (cleared on 'retracted')
    last_grader_user_id      BIGINT REFERENCES users (id) ON DELETE SET NULL,

    -- Soft TTL claim lock. claim_holder_user_id IS NULL OR claim_expires_at <
    -- NOW() => lock is available. The Grade query re-checks the claim
    -- atomically so a slow grader whose lease has expired cannot overwrite a
    -- claim someone else took.
    claim_holder_user_id     BIGINT REFERENCES users (id) ON DELETE SET NULL,
    claim_expires_at         TIMESTAMPTZ,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (student_user_id, subproblem_id)
);

CREATE INDEX idx_homework_thread_series  ON homework_thread (series_id);
CREATE INDEX idx_homework_thread_student ON homework_thread (student_user_id);

-- Grader queue: filter to threads in this center that need attention, with
-- an optional last-grader filter for appeal stickiness. Partial keeps it small.
CREATE INDEX idx_homework_thread_queue
    ON homework_thread (math_center_id, current_status, last_grader_user_id)
    WHERE current_status IN ('submitted', 'appealed');

-- Claim sweeps: cheap "find live claims" lookup, used by admin tools and
-- periodic expiry housekeeping if we ever add one.
CREATE INDEX idx_homework_thread_claim
    ON homework_thread (claim_expires_at)
    WHERE claim_holder_user_id IS NOT NULL;

CREATE TABLE homework_thread_event
(
    id                 BIGSERIAL PRIMARY KEY,
    thread_id          BIGINT      NOT NULL REFERENCES homework_thread (id) ON DELETE CASCADE,
    -- Server-allocated UUID (crypto/rand hex in Go, not pg's gen_random_uuid).
    -- Picked before any photo upload so the client can derive object keys
    -- that survive into the event row.
    event_uuid         TEXT        NOT NULL,
    kind               TEXT        NOT NULL
        CHECK (kind IN ('submitted', 'claimed', 'released', 'graded', 'retracted', 'appealed')),
    actor_user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body               TEXT        NOT NULL DEFAULT '',
    verdict            TEXT
        CHECK (verdict IS NULL OR verdict IN ('accepted', 'rejected')),
    -- Optional reference to another event this one targets. retracted →
    -- graded; graded-after-appeal → appealed; appealed → graded.
    refers_to_event_id BIGINT REFERENCES homework_thread_event (id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_uuid)
);

CREATE INDEX idx_homework_event_thread ON homework_thread_event (thread_id, id);
CREATE INDEX idx_homework_event_actor  ON homework_thread_event (actor_user_id, created_at);

-- Now that homework_thread_event exists, point the cache columns at it.
ALTER TABLE homework_thread
    ADD CONSTRAINT fk_homework_thread_attempt
        FOREIGN KEY (current_attempt_event_id) REFERENCES homework_thread_event (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_homework_thread_grade
        FOREIGN KEY (current_grade_event_id)   REFERENCES homework_thread_event (id) ON DELETE SET NULL;

-- Photos attached to a single event. Composite PK keeps INSERT order
-- deterministic; the policy cap (10 per event, 5 MiB each) is enforced both
-- here and in Go so a misbehaving client can't slip past.
CREATE TABLE homework_thread_event_photo
(
    event_id     BIGINT      NOT NULL REFERENCES homework_thread_event (id) ON DELETE CASCADE,
    idx          INTEGER     NOT NULL CHECK (idx >= 0 AND idx < 10),
    object_key   TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    content_type TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, idx)
);
CREATE INDEX idx_homework_event_photo_event ON homework_thread_event_photo (event_id);
