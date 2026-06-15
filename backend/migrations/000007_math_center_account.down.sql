-- Re-tightening invitation_token_id to NOT NULL requires that no row violates
-- it. MathCenter accounts are the only rows with a NULL token, so drop them
-- first (their math_center_teachers rows cascade away), then restore the
-- constraint and the column.
DELETE
FROM users
WHERE is_math_center = TRUE;

ALTER TABLE users
    ALTER COLUMN invitation_token_id SET NOT NULL;

ALTER TABLE users
    DROP COLUMN IF EXISTS is_math_center;
