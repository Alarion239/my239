-- name: GetThread :one
SELECT *
FROM homework_thread
WHERE id = $1;

-- name: GetThreadByStudentAndSubproblem :one
SELECT *
FROM homework_thread
WHERE student_user_id = $1
  AND subproblem_id   = $2;

-- name: FindOrCreateThread :one
-- INSERT ... ON CONFLICT DO UPDATE always returns a row, regardless of
-- whether we created it now or matched an existing one. The DO UPDATE bumps
-- updated_at so we can see activity even on no-op upserts.
INSERT INTO homework_thread (student_user_id, subproblem_id, series_id, math_center_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT (student_user_id, subproblem_id) DO UPDATE
    SET updated_at = NOW()
RETURNING *;

-- name: AppendEvent :one
INSERT INTO homework_thread_event
    (thread_id, event_uuid, kind, actor_user_id, body, verdict, refers_to_event_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: InsertEventPhoto :exec
INSERT INTO homework_thread_event_photo (event_id, idx, object_key, size_bytes, content_type)
VALUES ($1, $2, $3, $4, $5);

-- name: UpdateThreadAfterSubmit :exec
UPDATE homework_thread
SET current_status           = 'submitted',
    current_attempt_event_id = $2,
    updated_at               = NOW()
WHERE id = $1;

-- name: UpdateThreadAfterAppeal :exec
UPDATE homework_thread
SET current_status           = 'appealed',
    current_attempt_event_id = $2,
    updated_at               = NOW()
WHERE id = $1;

-- name: UpdateThreadAfterGrade :execrows
-- One statement does all four things atomically: set new status from
-- verdict, point the cache at the new grade event, record the grader for
-- appeal stickiness, AND clear the claim. The WHERE re-checks claim
-- ownership so a slow grader whose lease expired can't overwrite someone
-- else's claim. Caller inspects affected-row count to detect contention.
UPDATE homework_thread
SET current_status         = CASE
                                 WHEN @verdict::text = 'accepted' THEN 'accepted'
                                 ELSE 'rejected'
                             END,
    current_grade_event_id = @grade_event_id::bigint,
    last_grader_user_id    = @grader_user_id::bigint,
    claim_holder_user_id   = NULL,
    claim_expires_at       = NULL,
    updated_at             = NOW()
WHERE id = @id::bigint
  AND claim_holder_user_id = @grader_user_id::bigint
  AND claim_expires_at > NOW();

-- name: UpdateThreadAfterRetract :exec
-- After a retraction the thread reverts to whatever its most recent attempt
-- event was: 'submitted' for an original submission, 'appealed' for an
-- appeal. The handler passes that rollback status in $2.
UPDATE homework_thread
SET current_status         = $2,
    current_grade_event_id = NULL,
    updated_at             = NOW()
WHERE id = $1;

-- name: TryClaim :one
-- Returns the row when the claim is granted (no live holder, or the caller
-- already holds it). Returns no rows when someone else holds a live claim.
UPDATE homework_thread
SET claim_holder_user_id = @grader_user_id::bigint,
    claim_expires_at     = NOW() + INTERVAL '15 minutes',
    updated_at           = NOW()
WHERE id = @id::bigint
  AND (claim_holder_user_id IS NULL
       OR claim_expires_at < NOW()
       OR claim_holder_user_id = @grader_user_id::bigint)
RETURNING *;

-- name: HeartbeatClaim :execrows
UPDATE homework_thread
SET claim_expires_at = NOW() + INTERVAL '15 minutes',
    updated_at       = NOW()
WHERE id = @id::bigint
  AND claim_holder_user_id = @grader_user_id::bigint
  AND claim_expires_at > NOW();

-- name: ReleaseClaim :execrows
UPDATE homework_thread
SET claim_holder_user_id = NULL,
    claim_expires_at     = NULL,
    updated_at           = NOW()
WHERE id = @id::bigint
  AND claim_holder_user_id = @grader_user_id::bigint;

-- name: ListThreadEvents :many
SELECT *
FROM homework_thread_event
WHERE thread_id = $1
ORDER BY id ASC;

-- name: ListEventPhotosForEvents :many
SELECT *
FROM homework_thread_event_photo
WHERE event_id = ANY (@event_ids::bigint[])
ORDER BY event_id ASC, idx ASC;

-- name: GetEventKind :one
SELECT kind
FROM homework_thread_event
WHERE id = $1;

-- name: GetMostRecentGradedEvent :one
SELECT *
FROM homework_thread_event
WHERE thread_id = $1
  AND kind      = 'graded'
ORDER BY id DESC
LIMIT 1;

-- name: ListGraderQueueForSeries :many
-- Items needing grading: 'submitted' or 'appealed', not locked by someone
-- else (a stale lock counts as available). mine=true restricts to "my work":
-- threads I currently hold a live claim on, OR where I was the most recent
-- grader (appeal stickiness) — so a grader can find what they've taken on.
SELECT t.id              AS id,
       t.student_user_id AS student_user_id,
       t.subproblem_id   AS subproblem_id,
       t.series_id       AS series_id,
       t.math_center_id  AS math_center_id,
       t.current_status  AS current_status,
       t.last_grader_user_id AS last_grader_user_id,
       t.claim_holder_user_id AS claim_holder_user_id,
       t.claim_expires_at AS claim_expires_at,
       t.updated_at      AS updated_at,
       u.first_name      AS student_first_name,
       u.middle_name     AS student_middle_name,
       u.last_name       AS student_last_name,
       sp.label          AS subproblem_label,
       p.number          AS problem_number
FROM homework_thread t
         JOIN users u                       ON u.id  = t.student_user_id
         JOIN math_center_subproblems sp    ON sp.id = t.subproblem_id
         JOIN math_center_problems p        ON p.id  = sp.problem_id
WHERE t.series_id = $1
  AND t.current_status IN ('submitted', 'appealed')
  AND (t.claim_holder_user_id IS NULL
       OR t.claim_expires_at < NOW()
       OR t.claim_holder_user_id = @caller_user_id::bigint)
  AND (NOT @mine_only::bool
       OR t.last_grader_user_id = @caller_user_id::bigint
       OR (t.claim_holder_user_id = @caller_user_id::bigint
           AND t.claim_expires_at > NOW()))
ORDER BY t.current_status ASC,
         t.updated_at ASC;

-- name: GraderStatsForCenter :one
-- {pending, my_claimed, my_appeals} for the grader dashboard.
SELECT
    COUNT(*) FILTER (
        WHERE current_status IN ('submitted','appealed')
          AND (claim_holder_user_id IS NULL OR claim_expires_at < NOW())
    )::bigint AS pending_count,
    COUNT(*) FILTER (
        WHERE current_status IN ('submitted','appealed')
          AND claim_holder_user_id = @caller_user_id::bigint
          AND claim_expires_at >= NOW()
    )::bigint AS my_claimed_count,
    COUNT(*) FILTER (
        WHERE current_status = 'appealed'
          AND last_grader_user_id = @caller_user_id::bigint
    )::bigint AS my_appeals_count
FROM homework_thread
WHERE math_center_id = $1;

-- name: StudentSeriesRollup :many
-- Per-subproblem status grid for one student in one series. The LEFT JOIN
-- means subproblems the student hasn't touched still appear, with
-- status='ungraded'.
SELECT sp.id                                  AS subproblem_id,
       sp.label                               AS subproblem_label,
       p.id                                   AS problem_id,
       p.number                               AS problem_number,
       COALESCE(t.id, 0)::bigint              AS thread_id,
       COALESCE(t.current_status, 'ungraded') AS current_status,
       -- Privacy-safe "a grader has claimed this" flag: lets the student see
       -- "На проверке" vs "В очереди" without exposing the grader's identity.
       (t.claim_holder_user_id IS NOT NULL
            AND t.claim_expires_at > now())::boolean AS being_graded
FROM math_center_subproblems sp
         JOIN math_center_problems p ON p.id = sp.problem_id
         LEFT JOIN homework_thread t
                   ON t.subproblem_id   = sp.id
                  AND t.student_user_id = @student_user_id::bigint
WHERE p.series_id = $1
ORDER BY p.number ASC, sp.label ASC;

-- name: StudentSeriesCounts :one
-- One-row summary: accepted / rejected / pending. Pending lumps 'ungraded',
-- 'submitted', 'appealed' together (anything the student can't yet call done).
SELECT
    COUNT(*) FILTER (
        WHERE COALESCE(t.current_status, 'ungraded') = 'accepted'
    )::bigint AS accepted_count,
    COUNT(*) FILTER (
        WHERE COALESCE(t.current_status, 'ungraded') = 'rejected'
    )::bigint AS rejected_count,
    COUNT(*) FILTER (
        WHERE COALESCE(t.current_status, 'ungraded') IN ('ungraded','submitted','appealed')
    )::bigint AS pending_count
FROM math_center_subproblems sp
         JOIN math_center_problems p ON p.id = sp.problem_id
         LEFT JOIN homework_thread t
                   ON t.subproblem_id   = sp.id
                  AND t.student_user_id = @student_user_id::bigint
WHERE p.series_id = $1;

-- name: TeacherSeriesGrid :many
-- The full (student × subproblem) matrix for one series. Used by the
-- teacher spreadsheet view: every student of the series's math center is
-- crossed with every subproblem of the series, with the LEFT JOIN filling
-- in thread state where it exists (and 'ungraded' / null FKs where it
-- doesn't yet). Rows ordered for stable spreadsheet rendering.
SELECT
    mcs.user_id                            AS student_user_id,
    u.first_name                           AS student_first_name,
    u.middle_name                          AS student_middle_name,
    u.last_name                            AS student_last_name,
    g.id                                   AS group_id,
    g.name                                 AS group_name,
    sp.id                                  AS subproblem_id,
    sp.label                               AS subproblem_label,
    p.id                                   AS problem_id,
    p.number                               AS problem_number,
    COALESCE(t.id, 0)::bigint              AS thread_id,
    COALESCE(t.current_status, 'ungraded') AS current_status,
    t.last_grader_user_id                  AS last_grader_user_id,
    t.claim_holder_user_id                 AS claim_holder_user_id,
    t.claim_expires_at                     AS claim_expires_at,
    t.updated_at                           AS thread_updated_at
FROM math_center_students mcs
         JOIN users u  ON u.id  = mcs.user_id
         JOIN math_center_groups g ON g.id = mcs.group_id
         CROSS JOIN math_center_subproblems sp
         JOIN math_center_problems p  ON p.id  = sp.problem_id
         LEFT JOIN homework_thread t
                   ON t.student_user_id = mcs.user_id
                  AND t.subproblem_id   = sp.id
WHERE g.math_center_id = (SELECT s.math_center_id FROM math_center_series s WHERE s.id = $1)
  AND p.series_id = $1
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC, p.number ASC, sp.label ASC;

-- name: TeacherCenterGrid :many
-- The "all series for this center, every student" matrix used by the
-- teacher spreadsheet. Same shape as TeacherSeriesGrid but spans every
-- math_center_series in the center, so the frontend can render one
-- side-scrolling table across all psets and keep grouping/sort stable.
SELECT
    s.id                                   AS series_id,
    s.number                               AS series_number,
    s.name                                 AS series_name,
    s.due_at                               AS series_due_at,
    mcs.user_id                            AS student_user_id,
    u.first_name                           AS student_first_name,
    u.middle_name                          AS student_middle_name,
    u.last_name                            AS student_last_name,
    g.id                                   AS group_id,
    g.name                                 AS group_name,
    sp.id                                  AS subproblem_id,
    sp.label                               AS subproblem_label,
    p.id                                   AS problem_id,
    p.number                               AS problem_number,
    COALESCE(t.id, 0)::bigint              AS thread_id,
    COALESCE(t.current_status, 'ungraded') AS current_status,
    t.last_grader_user_id                  AS last_grader_user_id,
    t.claim_holder_user_id                 AS claim_holder_user_id,
    t.claim_expires_at                     AS claim_expires_at
FROM math_center_students mcs
         JOIN users u                       ON u.id = mcs.user_id
         JOIN math_center_groups g          ON g.id = mcs.group_id
         JOIN math_center_series s          ON s.math_center_id = g.math_center_id
         JOIN math_center_problems p        ON p.series_id = s.id
         JOIN math_center_subproblems sp    ON sp.problem_id = p.id
         LEFT JOIN homework_thread t
                   ON t.student_user_id = mcs.user_id
                  AND t.subproblem_id   = sp.id
WHERE g.math_center_id = $1
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC, s.number ASC, p.number ASC, sp.label ASC;

-- name: SeriesProblemStats :many
-- One row per (student × subproblem) for a whole series: the center roster
-- crossed with the series's subproblems, LEFT JOINed to that student's thread
-- so untouched subproblems still appear with status='ungraded'. The handler
-- folds these into per-(student,problem) precedence and per-problem counts.
-- Roster scoping mirrors TeacherSeriesGrid: every student of a group in the
-- series's math center.
SELECT
    mcs.user_id                            AS student_user_id,
    p.id                                   AS problem_id,
    p.number                               AS problem_number,
    sp.id                                  AS subproblem_id,
    COALESCE(t.current_status, 'ungraded') AS current_status
FROM math_center_students mcs
         JOIN math_center_groups g ON g.id = mcs.group_id
         CROSS JOIN math_center_subproblems sp
         JOIN math_center_problems p ON p.id = sp.problem_id
         LEFT JOIN homework_thread t
                   ON t.student_user_id = mcs.user_id
                  AND t.subproblem_id   = sp.id
WHERE g.math_center_id = (SELECT s.math_center_id FROM math_center_series s WHERE s.id = $1)
  AND p.series_id = $1
ORDER BY p.number ASC, p.id ASC, mcs.user_id ASC, sp.label ASC;

-- name: GetSubproblemContext :one
-- One-shot fetch of "what center/series/problem does this subproblem belong
-- to", used at the start of every event-creating handler so we don't have to
-- chain three queries.
SELECT sp.id            AS subproblem_id,
       sp.label         AS subproblem_label,
       p.id             AS problem_id,
       p.number         AS problem_number,
       s.id             AS series_id,
       s.math_center_id AS math_center_id,
       s.due_at         AS series_due_at,
       s.published_at   AS series_published_at
FROM math_center_subproblems sp
         JOIN math_center_problems p ON p.id = sp.problem_id
         JOIN math_center_series   s ON s.id = p.series_id
WHERE sp.id = $1;
