-- Drop the lowercase-username constraint so mixed-case names are accepted again.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_username_lowercase;

-- NOTE: this down migration does NOT restore the users deleted by the up
-- migration, nor the 'bootstrap-please-change-me' invitation token. Those
-- deletions are irreversible; re-provision users via registration (the
-- launch-time bootstrap token) and tokens via the token-generator CLI.
