DROP INDEX IF EXISTS common.idx_users_invitation_token_id;

ALTER TABLE common.users
DROP COLUMN IF EXISTS username,
DROP COLUMN IF EXISTS password_hash,
DROP COLUMN IF EXISTS invitation_token_id,
DROP COLUMN IF EXISTS created_at,
DROP COLUMN IF EXISTS updated_at;
