-- Math-center terms split a graduation-year cohort into its academic years
-- and summer camps. Existing data is intentionally kept together in one
-- read-only legacy term: the old schema does not contain reliable historical
-- roster snapshots, so inferring terms from due dates would be misleading.

CREATE TABLE math_center_terms
(
    id             BIGSERIAL PRIMARY KEY,
    math_center_id BIGINT      NOT NULL REFERENCES math_centers (id) ON DELETE CASCADE,
    kind           TEXT        NOT NULL CHECK (kind IN ('academic', 'camp', 'legacy')),
    grade          INTEGER,
    is_active      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at    TIMESTAMPTZ,
    CHECK (
        (kind = 'legacy' AND grade IS NULL)
        OR (kind = 'academic' AND grade BETWEEN 5 AND 11)
        OR (kind = 'camp' AND grade BETWEEN 5 AND 10)
    ),
    UNIQUE (id, math_center_id),
    UNIQUE (math_center_id, kind, grade)
);
CREATE UNIQUE INDEX idx_math_center_terms_one_active
    ON math_center_terms (math_center_id)
    WHERE is_active;
CREATE INDEX idx_math_center_terms_center ON math_center_terms (math_center_id, is_active DESC, grade DESC);

-- Every existing center becomes a clearly labelled archived legacy year.
INSERT INTO math_center_terms (math_center_id, kind, grade, is_active, archived_at)
SELECT id, 'legacy', NULL, FALSE, NOW()
FROM math_centers;

ALTER TABLE math_center_groups ADD COLUMN term_id BIGINT;
UPDATE math_center_groups g
SET term_id = t.id
FROM math_center_terms t
WHERE t.math_center_id = g.math_center_id
  AND t.kind = 'legacy';
ALTER TABLE math_center_groups ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE math_center_groups
    ADD CONSTRAINT fk_math_center_groups_term_center
        FOREIGN KEY (term_id, math_center_id)
            REFERENCES math_center_terms (id, math_center_id)
            ON DELETE CASCADE;
ALTER TABLE math_center_groups
    ADD CONSTRAINT uq_math_center_groups_id_term UNIQUE (id, term_id);
ALTER TABLE math_center_groups DROP CONSTRAINT math_center_groups_math_center_id_name_key;
ALTER TABLE math_center_groups
    ADD CONSTRAINT uq_math_center_groups_term_name UNIQUE (term_id, name);
CREATE INDEX idx_math_center_groups_term ON math_center_groups (term_id);

ALTER TABLE math_center_students ADD COLUMN term_id BIGINT;
UPDATE math_center_students s
SET term_id = g.term_id
FROM math_center_groups g
WHERE g.id = s.group_id;
ALTER TABLE math_center_students ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE math_center_students DROP CONSTRAINT math_center_students_user_id_key;
ALTER TABLE math_center_students
    ADD CONSTRAINT uq_math_center_students_user_term UNIQUE (user_id, term_id);
ALTER TABLE math_center_students
    ADD CONSTRAINT fk_math_center_students_group_term
        FOREIGN KEY (group_id, term_id)
            REFERENCES math_center_groups (id, term_id)
            ON DELETE CASCADE;
CREATE INDEX idx_math_center_students_term ON math_center_students (term_id);

ALTER TABLE math_center_series ADD COLUMN term_id BIGINT;
UPDATE math_center_series s
SET term_id = t.id
FROM math_center_terms t
WHERE t.math_center_id = s.math_center_id
  AND t.kind = 'legacy';
ALTER TABLE math_center_series ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE math_center_series
    ADD CONSTRAINT fk_math_center_series_term_center
        FOREIGN KEY (term_id, math_center_id)
            REFERENCES math_center_terms (id, math_center_id)
            ON DELETE CASCADE;
ALTER TABLE math_center_series DROP CONSTRAINT math_center_series_math_center_id_number_key;
ALTER TABLE math_center_series
    ADD CONSTRAINT uq_math_center_series_term_number UNIQUE (term_id, number);
CREATE INDEX idx_math_center_series_term ON math_center_series (term_id);
