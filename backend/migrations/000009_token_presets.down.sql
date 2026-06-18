-- Drop the preset column. Tokens revert to carrying no enrollment intent.
ALTER TABLE invitation_tokens
    DROP COLUMN IF EXISTS preset;

-- NOTE: this down migration does NOT restore the users wiped by the up
-- migration's TRUNCATE ... CASCADE. Those deletions are irreversible;
-- re-provision users via registration (the launch-time bootstrap token).
