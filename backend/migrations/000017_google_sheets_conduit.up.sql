-- Google Sheets links are scoped to one math-center term. A link identifies a
-- stable tab by its Google sheet id, rather than the mutable tab title.
CREATE TABLE math_center_google_sheet_links
(
    id                     BIGSERIAL PRIMARY KEY,
    term_id                BIGINT      NOT NULL REFERENCES math_center_terms (id) ON DELETE CASCADE,
    spreadsheet_id         TEXT        NOT NULL,
    sheet_id               BIGINT      NOT NULL,
    sheet_title            TEXT        NOT NULL,
    enabled                BOOLEAN     NOT NULL DEFAULT TRUE,
    last_google_version    TEXT        NOT NULL DEFAULT '',
    last_google_modified_at TIMESTAMPTZ,
    last_snapshot          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (term_id, spreadsheet_id, sheet_id)
);
CREATE INDEX idx_google_sheet_links_term ON math_center_google_sheet_links (term_id, enabled);

-- Each run is retained even when the parser rejects the source. This makes
-- service-account access, remote revisions, and later reconciliation auditable.
CREATE TABLE math_center_google_sheet_sync_runs
(
    id                     BIGSERIAL PRIMARY KEY,
    link_id                BIGINT      NOT NULL REFERENCES math_center_google_sheet_links (id) ON DELETE CASCADE,
    requested_by_user_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status                 TEXT        NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    google_version         TEXT        NOT NULL DEFAULT '',
    google_modified_at     TIMESTAMPTZ,
    summary                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error_message          TEXT        NOT NULL DEFAULT '',
    started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at            TIMESTAMPTZ
);
CREATE INDEX idx_google_sheet_sync_runs_link ON math_center_google_sheet_sync_runs (link_id, started_at DESC);

-- Local conduit changes are persisted before an external write is attempted.
-- A worker claims these rows with SKIP LOCKED, so restarts and multiple server
-- instances cannot lose a Sheets update.
CREATE TABLE math_center_google_sheet_outbox
(
    id             BIGSERIAL PRIMARY KEY,
    thread_id      BIGINT      NOT NULL REFERENCES homework_thread (id) ON DELETE CASCADE,
    attempts       INTEGER     NOT NULL DEFAULT 0,
    available_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at      TIMESTAMPTZ,
    last_error     TEXT        NOT NULL DEFAULT '',
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_google_sheet_outbox_ready
    ON math_center_google_sheet_outbox (available_at)
    WHERE completed_at IS NULL;

-- Imported events retain their ordinary offline-grade semantics while making
-- their remote origin inspectable in the event log.
ALTER TABLE homework_thread_event
    ADD COLUMN google_sheet_link_id BIGINT REFERENCES math_center_google_sheet_links (id) ON DELETE SET NULL,
    ADD COLUMN google_sheet_cell    TEXT NOT NULL DEFAULT '',
    ADD COLUMN google_sheet_version TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION enqueue_google_sheet_conduit_sync() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR OLD.current_status IS DISTINCT FROM NEW.current_status
       OR OLD.last_grader_user_id IS DISTINCT FROM NEW.last_grader_user_id
       OR OLD.last_grader_name IS DISTINCT FROM NEW.last_grader_name THEN
        INSERT INTO math_center_google_sheet_outbox (thread_id) VALUES (NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER homework_threads_google_sheet_outbox
AFTER INSERT OR UPDATE OF current_status, last_grader_user_id, last_grader_name
ON homework_thread
FOR EACH ROW EXECUTE FUNCTION enqueue_google_sheet_conduit_sync();
