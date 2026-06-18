-- Reset the user base and enforce lowercase usernames.
--
-- Usernames are now stored and looked up case-insensitively (every entry point
-- lowercases before the DB call). To make that an invariant rather than a
-- convention, we wipe the existing rows (which may contain mixed-case names)
-- and add a CHECK constraint. With zero users on a fresh deployment, the
-- server mints a single-use bootstrap invitation token at launch so the first
-- admin can self-register (the ensure_first_user_is_admin trigger from 000002
-- promotes whoever registers first).

-- Wipe all users FIRST. TRUNCATE ... CASCADE removes every row in tables that
-- reference users (refresh tokens, math-center memberships, homework
-- threads/events/photos) regardless of their ON DELETE action -- several of
-- those FKs (e.g. homework_thread_event.actor_user_id) are RESTRICT, so a plain
-- DELETE FROM users would fail. CASCADE truncates children only, so the parent
-- invitation_tokens table is left intact (users reference it, not vice versa).
-- This must precede deleting any invitation token: users.invitation_token_id is
-- a RESTRICT foreign key, so a referenced token cannot be removed until the
-- referencing users are gone.
TRUNCATE TABLE users CASCADE;

-- Now drop the insecure hardcoded seed token from 000002; the launch-time
-- bootstrap mints a random single-use token instead.
DELETE
FROM invitation_tokens
WHERE token = 'bootstrap-please-change-me';

-- Safe now that the table is empty: every future username must equal its own
-- lowercase form.
ALTER TABLE users
    ADD CONSTRAINT users_username_lowercase CHECK (username = lower(username));
