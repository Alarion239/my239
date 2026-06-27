-- Offline grading: graders accept solutions explained in person (the «кондуит»
-- workflow that used to live in Excel). An offline accept has no online photo
-- submission and may be applied from any state — it supersedes whatever was
-- there, while the full online event history stays in the log.
--
-- Two new event kinds:
--   accepted_offline  — verdict 'accepted', is_offline = true; thread → accepted.
--   offline_retracted — is_offline = true; reverts a prior offline accept.
--
-- Attribution: the session account is the event actor (authz + audit). The
-- *credited* grader is who actually graded in person — either a registered
-- teacher (credited_grader_user_id) resolved from typed initials, or a
-- free-text name (credited_grader_name) when that teacher isn't registered.

ALTER TABLE homework_thread_event
    DROP CONSTRAINT homework_thread_event_kind_check,
    ADD CONSTRAINT homework_thread_event_kind_check
        CHECK (kind IN ('submitted', 'claimed', 'released', 'graded', 'retracted',
                        'appealed', 'accepted_offline', 'offline_retracted'));

ALTER TABLE homework_thread_event
    ADD COLUMN is_offline              BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN credited_grader_user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN credited_grader_name    TEXT    NOT NULL DEFAULT '';

-- Denormalized credited display name for the most recent offline accept.
-- last_grader_user_id can only point at a registered user, so it cannot carry
-- an unregistered grader's initials; this column does. Empty for online grades
-- (the conduit falls back to the user-id → initials map) and cleared on undo.
ALTER TABLE homework_thread
    ADD COLUMN last_grader_name TEXT NOT NULL DEFAULT '';
