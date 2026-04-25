-- Add an is_admin flag and bootstrap an initial admin path.
--
-- Strategy: a BEFORE INSERT trigger promotes the very first user to admin.
-- This avoids needing a separate "promote-admin" CLI for an empty deployment
-- — whoever signs up first owns the system. After bootstrap, only existing
-- admins can promote others (via the admin API).
ALTER TABLE users
    ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE FUNCTION ensure_first_user_is_admin() RETURNS TRIGGER AS
    $$
BEGIN
    IF
NOT EXISTS (SELECT 1 FROM users) THEN
        NEW.is_admin = TRUE;
END IF;
RETURN NEW;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER trg_first_user_is_admin
    BEFORE INSERT
    ON users
    FOR EACH ROW
    EXECUTE FUNCTION ensure_first_user_is_admin();

-- Seed a bootstrap invitation token so the first user can register without
-- shell access to the DB. ON CONFLICT keeps re-runs idempotent. Operators
-- should revoke this token via the admin UI once the system is live.
INSERT INTO invitation_tokens (token, description, max_uses, expires_at)
VALUES ('bootstrap-please-change-me',
        'Initial bootstrap token — revoke after first admin signs up',
        1,
        NOW() + INTERVAL '30 days') ON CONFLICT (token) DO NOTHING;
