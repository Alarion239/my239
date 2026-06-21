DROP INDEX IF EXISTS idx_invitation_tokens_math_center_id;
ALTER TABLE invitation_tokens
    DROP COLUMN IF EXISTS math_center_id;
