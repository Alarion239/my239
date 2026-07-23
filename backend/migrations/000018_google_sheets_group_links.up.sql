-- Conduit tabs are one tab per group. The initials legend is deliberately
-- different: it belongs to the term and is only ever published by my239.
ALTER TABLE math_center_google_sheet_links
    ADD COLUMN group_id BIGINT REFERENCES math_center_groups (id) ON DELETE CASCADE,
    ADD COLUMN link_kind TEXT NOT NULL DEFAULT 'conduit'
        CHECK (link_kind IN ('conduit', 'initials_legend')),
    ADD COLUMN sync_direction TEXT NOT NULL DEFAULT 'two_way'
        CHECK (sync_direction IN ('two_way', 'outbound_only'));

CREATE INDEX idx_google_sheet_links_group
    ON math_center_google_sheet_links (group_id, enabled)
    WHERE group_id IS NOT NULL;
