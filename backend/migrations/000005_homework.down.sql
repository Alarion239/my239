DROP TABLE IF EXISTS homework_thread_event_photo;
DROP TABLE IF EXISTS homework_thread_event;
DROP TABLE IF EXISTS homework_thread;
-- Sentinel subproblems backfilled by the up migration are left in place
-- (harmless and idempotent with respect to series handlers).
