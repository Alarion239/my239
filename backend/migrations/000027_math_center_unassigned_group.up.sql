-- Keep every student enrolled in the center even before a head teacher places
-- them into a teaching group. The protected system group is represented by
-- the board's "Не распределены" column.
INSERT INTO math_center_groups (
    math_center_id,
    term_id,
    name
)
SELECT term.math_center_id,
       term.id,
       'Не распределены'
FROM math_center_terms term
WHERE NOT EXISTS (
    SELECT 1
    FROM math_center_groups group_row
    WHERE group_row.term_id = term.id
      AND group_row.name = 'Не распределены'
);

-- Older board versions removed the active enrollment when a card was dropped
-- into the unallocated column. Restore those students from the immediately
-- preceding term without changing any existing active assignment.
WITH previous_terms AS (
    SELECT DISTINCT ON (term.math_center_id)
           term.math_center_id,
           term.id
    FROM math_center_terms term
    WHERE NOT term.is_active
    ORDER BY term.math_center_id, term.created_at DESC, term.id DESC
),
active_terms AS (
    SELECT term.math_center_id,
           term.id
    FROM math_center_terms term
    WHERE term.is_active
),
unassigned_groups AS (
    SELECT group_row.math_center_id,
           group_row.term_id,
           group_row.id
    FROM math_center_groups group_row
    WHERE group_row.name = 'Не распределены'
)
INSERT INTO math_center_students (
    user_id,
    group_id,
    term_id,
    razbor_default_video,
    razbor_default_pdf_tex
)
SELECT previous_student.user_id,
       unassigned.id,
       active.id,
       previous_student.razbor_default_video,
       previous_student.razbor_default_pdf_tex
FROM active_terms active
JOIN previous_terms previous
  ON previous.math_center_id = active.math_center_id
JOIN unassigned_groups unassigned
  ON unassigned.math_center_id = active.math_center_id
 AND unassigned.term_id = active.id
JOIN math_center_students previous_student
  ON previous_student.term_id = previous.id
ON CONFLICT (user_id, term_id) DO NOTHING;
