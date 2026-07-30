-- Razbor access is managed per student enrollment (and therefore per term).
-- Existing and newly enrolled students keep access by default, so deploying
-- this mechanism does not change anyone's real access until a head teacher
-- explicitly turns it off.
ALTER TABLE math_center_students
    ADD COLUMN can_view_razbors BOOLEAN NOT NULL DEFAULT TRUE;
