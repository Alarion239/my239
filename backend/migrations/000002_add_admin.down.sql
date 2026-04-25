DROP TRIGGER IF EXISTS trg_first_user_is_admin ON users;
DROP FUNCTION IF EXISTS ensure_first_user_is_admin();
ALTER TABLE users
DROP
COLUMN IF EXISTS is_admin;
DELETE
FROM invitation_tokens
WHERE token = 'bootstrap-please-change-me';
