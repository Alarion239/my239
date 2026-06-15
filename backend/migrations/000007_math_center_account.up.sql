-- "MathCenter" account: a shared login opened on a classroom computer to
-- monitor progress and run general control during a session. Functionally it
-- behaves like a head teacher of one center (its rights come entirely from a
-- math_center_teachers row); the flag below marks the account *type* so the UI
-- and future monitoring features can tell it apart from a personal teacher.
ALTER TABLE users
    ADD COLUMN is_math_center BOOLEAN NOT NULL DEFAULT FALSE;

-- MathCenter accounts are admin-provisioned and have no invitation lineage, so
-- the link to an invitation token becomes optional. Self-registered users still
-- always carry one (the register handler keeps requiring a valid token).
ALTER TABLE users
    ALTER COLUMN invitation_token_id DROP NOT NULL;
