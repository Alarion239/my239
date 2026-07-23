ALTER TABLE math_center_series DROP CONSTRAINT uq_math_center_series_term_number;
ALTER TABLE math_center_series ADD CONSTRAINT math_center_series_math_center_id_number_key UNIQUE (math_center_id, number);
ALTER TABLE math_center_series DROP CONSTRAINT fk_math_center_series_term_center;
ALTER TABLE math_center_series DROP COLUMN term_id;

ALTER TABLE math_center_students DROP CONSTRAINT fk_math_center_students_group_term;
ALTER TABLE math_center_students DROP CONSTRAINT uq_math_center_students_user_term;
ALTER TABLE math_center_students ADD CONSTRAINT math_center_students_user_id_key UNIQUE (user_id);
ALTER TABLE math_center_students DROP COLUMN term_id;

ALTER TABLE math_center_groups DROP CONSTRAINT uq_math_center_groups_term_name;
ALTER TABLE math_center_groups ADD CONSTRAINT math_center_groups_math_center_id_name_key UNIQUE (math_center_id, name);
ALTER TABLE math_center_groups DROP CONSTRAINT uq_math_center_groups_id_term;
ALTER TABLE math_center_groups DROP CONSTRAINT fk_math_center_groups_term_center;
ALTER TABLE math_center_groups DROP COLUMN term_id;

DROP INDEX idx_math_center_terms_one_active;
DROP TABLE math_center_terms;
