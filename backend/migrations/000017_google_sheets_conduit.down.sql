DROP TRIGGER IF EXISTS homework_threads_google_sheet_outbox ON homework_thread;
DROP FUNCTION IF EXISTS enqueue_google_sheet_conduit_sync();

ALTER TABLE homework_thread_event
    DROP COLUMN IF EXISTS google_sheet_version,
    DROP COLUMN IF EXISTS google_sheet_cell,
    DROP COLUMN IF EXISTS google_sheet_link_id;

DROP TABLE IF EXISTS math_center_google_sheet_outbox;
DROP TABLE IF EXISTS math_center_google_sheet_sync_runs;
DROP TABLE IF EXISTS math_center_google_sheet_links;
