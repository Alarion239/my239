ALTER TABLE homework_thread
    DROP COLUMN IF EXISTS last_grader_name;

ALTER TABLE homework_thread_event
    DROP COLUMN IF EXISTS credited_grader_name,
    DROP COLUMN IF EXISTS credited_grader_user_id,
    DROP COLUMN IF EXISTS is_offline;

ALTER TABLE homework_thread_event
    DROP CONSTRAINT homework_thread_event_kind_check,
    ADD CONSTRAINT homework_thread_event_kind_check
        CHECK (kind IN ('submitted', 'claimed', 'released', 'graded', 'retracted', 'appealed'));
