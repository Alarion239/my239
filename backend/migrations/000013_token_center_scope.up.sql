-- Scope an invitation token to a single math center so head-teacher panels can
-- list/revoke only their own invites and tokens cascade-delete with the center.
-- NULL = a global (admin-minted) token, unchanged. Enrollment itself is still
-- driven by the `preset` JSONB column; this is purely ownership/scoping.
ALTER TABLE invitation_tokens
    ADD COLUMN math_center_id BIGINT REFERENCES math_centers (id) ON DELETE CASCADE;

CREATE INDEX idx_invitation_tokens_math_center_id
    ON invitation_tokens (math_center_id)
    WHERE math_center_id IS NOT NULL;
