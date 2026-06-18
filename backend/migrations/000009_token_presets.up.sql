-- Invitation tokens now carry a versioned "preset" describing who the
-- registrant becomes (admin grant, math-center student/teacher enrollment,
-- and future consumers). The preset is validated when the token is minted and
-- ENFORCED server-side at registration — the registrant cannot override it.
--
-- Stored as JSONB rather than dedicated columns so new consumers (e.g. alumni)
-- can be added by extending the typed Go schema in internal/tokenpreset WITHOUT
-- another migration. The empty object '{}' means "no extra grants" — the same
-- behaviour tokens had before this column existed.
ALTER TABLE invitation_tokens
    ADD COLUMN preset JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Clean slate, requested just in case: wipe the user base so no pre-existing
-- account predates preset enforcement. TRUNCATE ... CASCADE removes every row
-- in tables that reference users (refresh tokens, math-center memberships,
-- homework threads/events/photos) regardless of their ON DELETE action —
-- several of those FKs are RESTRICT, so a plain DELETE FROM users would fail.
-- CASCADE truncates children only, leaving invitation_tokens intact.
TRUNCATE TABLE users CASCADE;
