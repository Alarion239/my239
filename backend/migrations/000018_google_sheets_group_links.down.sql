DROP INDEX IF EXISTS idx_google_sheet_links_group;

ALTER TABLE math_center_google_sheet_links
    DROP COLUMN IF EXISTS sync_direction,
    DROP COLUMN IF EXISTS link_kind,
    DROP COLUMN IF EXISTS group_id;
