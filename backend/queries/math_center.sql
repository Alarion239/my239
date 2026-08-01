-- name: CreateMathCenter :one
INSERT INTO math_centers (graduation_year)
VALUES ($1)
RETURNING *;

-- name: ListMathCenters :many
SELECT *
FROM math_centers
ORDER BY graduation_year ASC;

-- name: GetMathCenter :one
SELECT *
FROM math_centers
WHERE id = $1;

-- name: DeleteMathCenter :execrows
DELETE
FROM math_centers
WHERE id = $1;

-- name: CreateMathCenterGroup :one
INSERT INTO math_center_groups (math_center_id, term_id, name)
SELECT $1, t.id, $2
FROM math_center_terms t
WHERE t.math_center_id = $1
  AND t.is_active = TRUE
RETURNING id, math_center_id, name, created_at;

-- name: ListGroupsForCenter :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT g.id, g.math_center_id, g.name, g.created_at
FROM math_center_groups g
WHERE g.math_center_id = $1
  AND g.term_id = (SELECT id FROM selected_term)
ORDER BY name ASC;

-- name: GetGroup :one
SELECT id, math_center_id, name, created_at
FROM math_center_groups
WHERE id = $1;

-- name: GetGroupCenter :one
SELECT id, math_center_id, term_id
FROM math_center_groups
WHERE id = $1;

-- name: DeleteMathCenterGroup :execrows
DELETE
FROM math_center_groups
WHERE id = $1
  AND name <> 'Не распределены';

-- name: AddStudentToGroup :one
INSERT INTO math_center_students (
    user_id,
    group_id,
    term_id,
    razbor_default_video,
    razbor_default_pdf_tex
)
SELECT $1,
       g.id,
       g.term_id,
       g.razbor_default_video,
       g.razbor_default_pdf_tex
FROM math_center_groups g
WHERE g.id = @group_id::bigint
RETURNING id, user_id, group_id, created_at;

-- name: InitializeStudentRazborAccess :exec
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       student.razbor_default_video,
       student.razbor_default_pdf_tex
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
WHERE student.id = $1
ON CONFLICT (student_user_id, series_id) DO NOTHING;

-- name: InitializeSeriesRazborAccess :exec
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       student.razbor_default_video,
       student.razbor_default_pdf_tex
FROM math_center_students student
JOIN math_center_series series ON series.id = $1 AND series.term_id = student.term_id
ON CONFLICT (student_user_id, series_id) DO NOTHING;

-- name: GetStudentByUserID :one
SELECT s.id          AS id,
       s.user_id     AS user_id,
       s.group_id    AS group_id,
       s.can_view_razbors AS can_view_razbors,
       g.name        AS group_name,
       g.math_center_id AS math_center_id,
       mc.graduation_year AS graduation_year
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN math_centers mc ON mc.id = g.math_center_id
         JOIN math_center_terms t ON t.id = s.term_id
WHERE s.user_id = $1
  AND (t.is_active = TRUE OR NOT EXISTS (
      SELECT 1 FROM math_center_terms active
      WHERE active.math_center_id = g.math_center_id
        AND active.is_active = TRUE
  ))
ORDER BY t.is_active DESC, s.id DESC
LIMIT 1;

-- name: ListStudentsForCenter :many
SELECT s.id        AS id,
       s.user_id   AS user_id,
       s.group_id  AS group_id,
       s.can_view_razbors AS can_view_razbors,
       g.name      AS group_name,
       u.first_name AS first_name,
       u.middle_name AS middle_name,
       u.last_name AS last_name
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN users u ON u.id = s.user_id
WHERE g.term_id = COALESCE(
    (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
    (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
)
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC;

-- name: GetRosterBoardMetadata :one
WITH active_term AS (
    SELECT term_row.id, term_row.created_at
    FROM math_center_terms term_row
    WHERE term_row.math_center_id = $1
      AND term_row.is_active = TRUE
    LIMIT 1
),
previous_term AS (
    SELECT t.id, t.created_at
    FROM math_center_terms t
    WHERE t.math_center_id = $1
      AND t.is_active = FALSE
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 1
),
published_series AS (
    SELECT COUNT(*)::bigint AS count
    FROM math_center_series series
    WHERE series.term_id = (SELECT id FROM active_term)
      AND series.published_at IS NOT NULL
)
SELECT (SELECT id FROM active_term)::bigint AS active_term_id,
       published_series.count AS published_series_count,
       CASE
         WHEN published_series.count >= 10
              OR NOT EXISTS (SELECT 1 FROM previous_term)
           THEN (SELECT id FROM active_term)
         ELSE (SELECT id FROM previous_term)
       END::bigint AS rating_term_id
FROM published_series;

-- name: ListRosterBoardStudentsForManage :many
-- The allocation board compares the active roster with the immediately
-- preceding term. The protected "Не распределены" group is represented as a
-- null current/previous group in this management view. Rating is deliberately a
-- derived value: it currently mirrors the credited "Решено" total and can be
-- replaced by a difficulty-weighted calculation without changing the API.
WITH active_term AS (
    SELECT term_row.id, term_row.created_at
    FROM math_center_terms term_row
    WHERE term_row.math_center_id = $1
      AND term_row.is_active = TRUE
    LIMIT 1
),
previous_term AS (
    SELECT t.id, t.created_at
    FROM math_center_terms t
    WHERE t.math_center_id = $1
      AND t.is_active = FALSE
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 1
),
published_series AS (
    SELECT COUNT(*)::bigint AS count
    FROM math_center_series series
    WHERE series.term_id = (SELECT id FROM active_term)
      AND series.published_at IS NOT NULL
),
rating_term AS (
    SELECT CASE
             WHEN published_series.count >= 10
                  OR NOT EXISTS (SELECT 1 FROM previous_term)
               THEN (SELECT id FROM active_term)
             ELSE (SELECT id FROM previous_term)
           END AS id
    FROM published_series
),
candidates AS (
    SELECT student.user_id
    FROM math_center_students student
    WHERE student.term_id = (SELECT id FROM active_term)
    UNION
    SELECT student.user_id
    FROM math_center_students student
    WHERE student.term_id = (SELECT id FROM previous_term)
),
current_enrollment AS (
    SELECT student.user_id,
           CASE WHEN group_row.name = 'Не распределены' THEN NULL::bigint ELSE student.group_id END AS group_id
    FROM math_center_students student
    JOIN math_center_groups group_row ON group_row.id = student.group_id
    WHERE student.term_id = (SELECT id FROM active_term)
),
previous_enrollment AS (
    SELECT student.user_id,
           CASE WHEN group_row.name = 'Не распределены' THEN NULL::bigint ELSE group_row.id END AS group_id,
           CASE WHEN group_row.name = 'Не распределены' THEN NULL::text ELSE group_row.name END AS group_name
    FROM math_center_students student
    JOIN math_center_groups group_row ON group_row.id = student.group_id
    WHERE student.term_id = (SELECT id FROM previous_term)
),
rating_totals AS (
    SELECT thread.student_user_id,
           COUNT(*)::double precision AS rating
    FROM homework_thread thread
    JOIN math_center_subproblems subproblem ON subproblem.id = thread.subproblem_id
    JOIN math_center_problems problem ON problem.id = subproblem.problem_id
    JOIN math_center_series series ON series.id = problem.series_id
    WHERE series.term_id = (SELECT id FROM rating_term)
      AND series.published_at IS NOT NULL
      AND problem.number <> 0
      AND thread.current_status = 'accepted'
      AND NOT EXISTS (
          SELECT 1
          FROM math_center_problems exercise
          JOIN math_center_subproblems exercise_subproblem
            ON exercise_subproblem.problem_id = exercise.id
          LEFT JOIN homework_thread exercise_thread
            ON exercise_thread.student_user_id = thread.student_user_id
           AND exercise_thread.subproblem_id = exercise_subproblem.id
          WHERE exercise.series_id = series.id
            AND exercise.number = 0
            AND COALESCE(exercise_thread.current_status, 'ungraded') <> 'accepted'
      )
    GROUP BY thread.student_user_id
)
SELECT candidate.user_id,
       current_enrollment.group_id AS current_group_id,
       previous_enrollment.group_id AS previous_group_id,
       previous_enrollment.group_name AS previous_group_name,
       (previous_enrollment.user_id IS NOT NULL)::boolean AS previous_term_enrolled,
       user_row.first_name,
       user_row.middle_name,
       user_row.last_name,
       COALESCE(rating_totals.rating, 0)::double precision AS rating,
       (SELECT count FROM published_series)::bigint AS published_series_count,
       (SELECT id FROM rating_term)::bigint AS rating_term_id
FROM candidates candidate
JOIN users user_row ON user_row.id = candidate.user_id
LEFT JOIN current_enrollment ON current_enrollment.user_id = candidate.user_id
LEFT JOIN previous_enrollment ON previous_enrollment.user_id = candidate.user_id
LEFT JOIN rating_totals ON rating_totals.student_user_id = candidate.user_id
ORDER BY user_row.last_name ASC, user_row.first_name ASC, user_row.middle_name ASC, candidate.user_id ASC;

-- name: GetActiveStudentByUser :one
SELECT student.id,
       student.user_id,
       student.group_id,
       student.term_id,
       student.can_view_razbors,
       student.razbor_default_video,
       student.razbor_default_pdf_tex
FROM math_center_students student
JOIN math_center_groups group_row ON group_row.id = student.group_id
JOIN math_center_terms term_row ON term_row.id = student.term_id
WHERE student.user_id = $1
  AND group_row.math_center_id = $2
  AND term_row.is_active = TRUE;

-- name: RemoveActiveStudentByUser :execrows
DELETE FROM math_center_students student
USING math_center_groups group_row, math_center_terms term_row
WHERE student.user_id = $1
  AND group_row.id = student.group_id
  AND term_row.id = student.term_id
  AND group_row.math_center_id = $2
  AND term_row.is_active = TRUE;

-- name: ListRazborAccessSeriesForManage :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT series.id AS series_id,
       series.number AS series_number,
       series.name AS series_name,
       EXISTS (
           SELECT 1
           FROM math_center_problems problem
           JOIN math_center_subproblems subproblem ON subproblem.problem_id = problem.id
           JOIN math_center_subproblem_solutions solution ON solution.subproblem_id = subproblem.id
           WHERE problem.series_id = series.id
             AND NOT solution.is_coffin
             AND (solution.solution_tex_source IS NOT NULL OR solution.solution_pdf_object_key IS NOT NULL)
       ) AS written_posted,
       EXISTS (
           SELECT 1
           FROM math_center_problems problem
           JOIN math_center_subproblems subproblem ON subproblem.problem_id = problem.id
           JOIN math_center_subproblem_solutions solution ON solution.subproblem_id = subproblem.id
           WHERE problem.series_id = series.id
             AND NOT solution.is_coffin
             AND solution.solution_link IS NOT NULL
       ) AS video_posted
FROM math_center_series series
WHERE series.math_center_id = $1
  AND series.term_id = (SELECT id FROM selected_term)
ORDER BY series.number ASC;

-- name: ListRazborAccessGroupsForManage :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT group_row.id,
       group_row.math_center_id,
       group_row.name,
       group_row.razbor_default_video,
       group_row.razbor_default_pdf_tex
FROM math_center_groups group_row
WHERE group_row.math_center_id = $1
  AND group_row.term_id = (SELECT id FROM selected_term)
ORDER BY group_row.name ASC;

-- name: ListRazborAccessStudentsForManage :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT student.id AS student_id,
       student.user_id,
       student.group_id,
       student.razbor_default_video,
       student.razbor_default_pdf_tex,
       group_row.name AS group_name,
       user_row.first_name,
       user_row.middle_name,
       user_row.last_name
FROM math_center_students student
JOIN math_center_groups group_row ON group_row.id = student.group_id
JOIN users user_row ON user_row.id = student.user_id
WHERE group_row.math_center_id = $1
  AND student.term_id = (SELECT id FROM selected_term)
ORDER BY group_row.name ASC, user_row.last_name ASC, user_row.first_name ASC;

-- name: ListRazborAccessCellsForManage :many
WITH selected_term AS (
    SELECT COALESCE(
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.is_active = TRUE),
        (SELECT t.id FROM math_center_terms t WHERE t.math_center_id = $1 AND t.kind = 'legacy')
    ) AS id
)
SELECT student.id AS student_id,
       student.group_id,
       series.id AS series_id,
       COALESCE(access.can_view_video, student.razbor_default_video)::boolean AS can_view_video,
       COALESCE(access.can_view_pdf_tex, student.razbor_default_pdf_tex)::boolean AS can_view_pdf_tex
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
LEFT JOIN math_center_student_series_razbor_access access
  ON access.student_user_id = student.user_id
 AND access.series_id = series.id
WHERE student.term_id = (SELECT id FROM selected_term)
  AND EXISTS (
      SELECT 1 FROM math_center_groups group_row
      WHERE group_row.id = student.group_id
        AND group_row.math_center_id = $1
  )
ORDER BY student.id, series.number;

-- name: SetStudentRazborMatrixSeries :execrows
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       CASE WHEN sqlc.arg(format)::text = 'video'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_video, student.razbor_default_video)
       END,
       CASE WHEN sqlc.arg(format)::text = 'pdf_tex'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_pdf_tex, student.razbor_default_pdf_tex)
       END
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
JOIN math_center_terms active_term ON active_term.id = student.term_id AND active_term.is_active = TRUE
LEFT JOIN math_center_student_series_razbor_access access
  ON access.student_user_id = student.user_id
 AND access.series_id = series.id
WHERE student.id = sqlc.arg(student_id)::bigint
  AND (sqlc.arg(series_id)::bigint = 0 OR series.id = sqlc.arg(series_id)::bigint)
ON CONFLICT (student_user_id, series_id)
DO UPDATE SET can_view_video = EXCLUDED.can_view_video,
              can_view_pdf_tex = EXCLUDED.can_view_pdf_tex,
              updated_at = NOW();

-- name: SetGroupRazborMatrixSeries :execrows
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       CASE WHEN sqlc.arg(format)::text = 'video'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_video, student.razbor_default_video)
       END,
       CASE WHEN sqlc.arg(format)::text = 'pdf_tex'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_pdf_tex, student.razbor_default_pdf_tex)
       END
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
JOIN math_center_terms active_term ON active_term.id = student.term_id AND active_term.is_active = TRUE
LEFT JOIN math_center_student_series_razbor_access access
  ON access.student_user_id = student.user_id
 AND access.series_id = series.id
WHERE student.group_id = sqlc.arg(group_id)::bigint
  AND (sqlc.arg(series_id)::bigint = 0 OR series.id = sqlc.arg(series_id)::bigint)
ON CONFLICT (student_user_id, series_id)
DO UPDATE SET can_view_video = EXCLUDED.can_view_video,
              can_view_pdf_tex = EXCLUDED.can_view_pdf_tex,
              updated_at = NOW();

-- name: SetTermRazborMatrixSeries :execrows
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       CASE WHEN sqlc.arg(format)::text = 'video'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_video, student.razbor_default_video)
       END,
       CASE WHEN sqlc.arg(format)::text = 'pdf_tex'
            THEN sqlc.arg(allowed)::boolean
            ELSE COALESCE(access.can_view_pdf_tex, student.razbor_default_pdf_tex)
       END
FROM math_center_students student
JOIN math_center_series series ON series.term_id = student.term_id
JOIN math_center_terms term ON term.id = student.term_id
LEFT JOIN math_center_student_series_razbor_access access
  ON access.student_user_id = student.user_id
 AND access.series_id = series.id
WHERE term.math_center_id = sqlc.arg(math_center_id)::bigint
  AND term.is_active = TRUE
  AND (sqlc.arg(series_id)::bigint = 0 OR series.id = sqlc.arg(series_id)::bigint)
ON CONFLICT (student_user_id, series_id)
DO UPDATE SET can_view_video = EXCLUDED.can_view_video,
              can_view_pdf_tex = EXCLUDED.can_view_pdf_tex,
              updated_at = NOW();

-- name: SetStudentRazborDefaultVideo :execrows
UPDATE math_center_students
SET razbor_default_video = sqlc.arg(allowed)::boolean
WHERE id = sqlc.arg(student_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT g.math_center_id FROM math_center_groups g JOIN math_center_students s ON s.group_id = g.id WHERE s.id = sqlc.arg(student_id)::bigint));

-- name: SetStudentRazborDefaultPDFTex :execrows
UPDATE math_center_students
SET razbor_default_pdf_tex = sqlc.arg(allowed)::boolean
WHERE id = sqlc.arg(student_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT g.math_center_id FROM math_center_groups g JOIN math_center_students s ON s.group_id = g.id WHERE s.id = sqlc.arg(student_id)::bigint));

-- name: SetGroupRazborDefaultVideo :execrows
UPDATE math_center_groups
SET razbor_default_video = sqlc.arg(allowed)::boolean
WHERE id = sqlc.arg(group_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT math_center_id FROM math_center_groups WHERE id = sqlc.arg(group_id)::bigint));

-- name: SetGroupRazborDefaultPDFTex :execrows
UPDATE math_center_groups
SET razbor_default_pdf_tex = sqlc.arg(allowed)::boolean
WHERE id = sqlc.arg(group_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT math_center_id FROM math_center_groups WHERE id = sqlc.arg(group_id)::bigint));

-- name: SetStudentsRazborDefaultVideoForGroup :exec
UPDATE math_center_students
SET razbor_default_video = sqlc.arg(allowed)::boolean
WHERE group_id = sqlc.arg(group_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT math_center_id FROM math_center_groups WHERE id = sqlc.arg(group_id)::bigint));

-- name: SetStudentsRazborDefaultPDFTexForGroup :exec
UPDATE math_center_students
SET razbor_default_pdf_tex = sqlc.arg(allowed)::boolean
WHERE group_id = sqlc.arg(group_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE is_active = TRUE AND math_center_id = (SELECT math_center_id FROM math_center_groups WHERE id = sqlc.arg(group_id)::bigint));

-- name: SetGroupsRazborDefaultVideoForCenter :exec
UPDATE math_center_groups
SET razbor_default_video = sqlc.arg(allowed)::boolean
WHERE math_center_id = sqlc.arg(math_center_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE math_center_id = sqlc.arg(math_center_id)::bigint AND is_active = TRUE);

-- name: SetGroupsRazborDefaultPDFTexForCenter :exec
UPDATE math_center_groups
SET razbor_default_pdf_tex = sqlc.arg(allowed)::boolean
WHERE math_center_id = sqlc.arg(math_center_id)::bigint
  AND term_id = (SELECT id FROM math_center_terms WHERE math_center_id = sqlc.arg(math_center_id)::bigint AND is_active = TRUE);

-- name: SetStudentsRazborDefaultVideoForCenter :exec
UPDATE math_center_students
SET razbor_default_video = sqlc.arg(allowed)::boolean
WHERE term_id = (SELECT id FROM math_center_terms WHERE math_center_id = sqlc.arg(math_center_id)::bigint AND is_active = TRUE);

-- name: SetStudentsRazborDefaultPDFTexForCenter :exec
UPDATE math_center_students
SET razbor_default_pdf_tex = sqlc.arg(allowed)::boolean
WHERE term_id = (SELECT id FROM math_center_terms WHERE math_center_id = sqlc.arg(math_center_id)::bigint AND is_active = TRUE);

-- name: RemoveStudent :execrows
DELETE
FROM math_center_students
WHERE id = $1;

-- name: AddTeacherToCenter :one
INSERT INTO math_center_teachers (user_id, math_center_id, is_head_teacher)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListTeachersForCenter :many
SELECT t.id              AS id,
       t.user_id         AS user_id,
       t.math_center_id  AS math_center_id,
       t.is_head_teacher AS is_head_teacher,
       u.first_name      AS first_name,
       u.middle_name     AS middle_name,
       u.last_name       AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = $1
ORDER BY t.is_head_teacher DESC, u.last_name ASC, u.first_name ASC;

-- name: ListCentersForTeacher :many
SELECT mc.id                AS id,
       mc.graduation_year   AS graduation_year,
       t.is_head_teacher    AS is_head_teacher
FROM math_center_teachers t
         JOIN math_centers mc ON mc.id = t.math_center_id
WHERE t.user_id = $1
ORDER BY mc.graduation_year ASC;

-- name: ListTeacherEnrollmentsForUser :many
-- Like ListCentersForTeacher, but also returns the math_center_teachers row id
-- (teacher_id) so the admin UI can remove an individual teaching enrollment.
SELECT t.id              AS teacher_id,
       t.math_center_id  AS center_id,
       mc.graduation_year AS graduation_year,
       t.is_head_teacher AS is_head_teacher
FROM math_center_teachers t
         JOIN math_centers mc ON mc.id = t.math_center_id
WHERE t.user_id = $1
ORDER BY mc.graduation_year DESC;

-- name: SetTeacherHead :execrows
UPDATE math_center_teachers
SET is_head_teacher = $2
WHERE id = $1;

-- name: RemoveTeacher :execrows
DELETE
FROM math_center_teachers
WHERE id = $1;

-- name: ListHeadTeachersForCenter :many
SELECT t.id          AS id,
       t.user_id     AS user_id,
       u.first_name  AS first_name,
       u.middle_name AS middle_name,
       u.last_name   AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = $1
  AND t.is_head_teacher = TRUE
ORDER BY u.last_name ASC, u.first_name ASC;

-- name: ListTeachersForCenters :many
SELECT t.id              AS id,
       t.user_id         AS user_id,
       t.math_center_id  AS math_center_id,
       t.is_head_teacher AS is_head_teacher,
       u.first_name      AS first_name,
       u.middle_name     AS middle_name,
       u.last_name       AS last_name
FROM math_center_teachers t
         JOIN users u ON u.id = t.user_id
WHERE t.math_center_id = ANY(@center_ids::bigint[])
ORDER BY t.math_center_id ASC, t.is_head_teacher DESC, u.last_name ASC, u.first_name ASC;

-- name: ListGroupsForCenters :many
SELECT id, math_center_id, name, created_at, term_id
FROM math_center_groups
WHERE term_id = COALESCE(
    (SELECT id
     FROM math_center_terms t
     WHERE t.math_center_id = math_center_groups.math_center_id
       AND t.is_active = TRUE),
    (SELECT id
     FROM math_center_terms t
     WHERE t.math_center_id = math_center_groups.math_center_id
       AND t.kind = 'legacy')
)
  AND math_center_id = ANY(@center_ids::bigint[])
ORDER BY math_center_id ASC, name ASC;

-- name: ListStudentsForCenters :many
SELECT s.id            AS id,
       s.user_id       AS user_id,
       s.group_id      AS group_id,
       g.name          AS group_name,
       g.math_center_id AS math_center_id,
       u.first_name    AS first_name,
       u.middle_name   AS middle_name,
       u.last_name     AS last_name
FROM math_center_students s
         JOIN math_center_groups g ON g.id = s.group_id
         JOIN users u ON u.id = s.user_id
WHERE s.term_id = COALESCE(
    (SELECT id
     FROM math_center_terms t
     WHERE t.math_center_id = g.math_center_id
       AND t.is_active = TRUE),
    (SELECT id
     FROM math_center_terms t
     WHERE t.math_center_id = g.math_center_id
       AND t.kind = 'legacy')
)
  AND g.math_center_id = ANY(@center_ids::bigint[])
ORDER BY g.math_center_id ASC, g.name ASC, u.last_name ASC, u.first_name ASC;

-- name: IsHeadTeacherInCenter :one
SELECT EXISTS (
    SELECT 1
    FROM math_center_teachers
    WHERE user_id = $1
      AND math_center_id = $2
      AND is_head_teacher = TRUE
) AS is_head_teacher;

-- name: CountHeadTeachersForCenter :one
SELECT COUNT(*)
FROM math_center_teachers
WHERE math_center_id = $1
  AND is_head_teacher = TRUE;

-- name: GetTeacher :one
SELECT *
FROM math_center_teachers
WHERE id = $1;

-- name: GetStudent :one
SELECT id, user_id, group_id, created_at, can_view_razbors
FROM math_center_students
WHERE id = $1;

-- name: SetStudentGroup :execrows
UPDATE math_center_students
SET group_id = $2
WHERE id = $1;

-- name: SetStudentRazborAccess :execrows
UPDATE math_center_students
SET can_view_razbors = $2
WHERE id = $1;

-- name: CanStudentViewRazbors :one
-- Match the current-enrollment semantics used by IsStudentInCenter. The legacy
-- fallback keeps pre-term centers working until they open an active term.
SELECT COALESCE((
    SELECT s.can_view_razbors
    FROM math_center_students s
             JOIN math_center_groups g ON g.id = s.group_id
             JOIN math_center_terms t ON t.id = s.term_id
    WHERE s.user_id = $1
      AND g.math_center_id = $2
      AND (
          t.is_active = TRUE
          OR NOT EXISTS (
              SELECT 1
              FROM math_center_terms active
              WHERE active.math_center_id = $2
                AND active.is_active = TRUE
          )
      )
    ORDER BY t.is_active DESC, s.id DESC
    LIMIT 1
), FALSE)::boolean AS can_view_razbors;

-- name: ListStudentSeriesRazborAccessForManage :many
-- The management panel is term-scoped through the selected student enrollment.
-- Missing overrides inherit the enrollment-wide default.
SELECT series.id AS series_id,
       series.number AS series_number,
       series.name AS series_name,
       COALESCE(access.can_view_video, student.razbor_default_video, student.can_view_razbors)::boolean AS can_view_video,
       COALESCE(access.can_view_pdf_tex, student.razbor_default_pdf_tex, student.can_view_razbors)::boolean AS can_view_pdf_tex
FROM math_center_students student
         JOIN math_center_series series ON series.term_id = student.term_id
         LEFT JOIN math_center_student_series_razbor_access access
                   ON access.student_user_id = student.user_id
                       AND access.series_id = series.id
WHERE student.id = $1
ORDER BY series.number ASC;

-- name: SetStudentSeriesRazborAccess :execrows
-- The INSERT ... SELECT is also the same-center/same-term authorization check:
-- a series outside this enrollment produces zero affected rows.
INSERT INTO math_center_student_series_razbor_access (
    student_user_id,
    series_id,
    can_view_video,
    can_view_pdf_tex
)
SELECT student.user_id,
       series.id,
       $3,
       $4
FROM math_center_students student
         JOIN math_center_groups student_group ON student_group.id = student.group_id
         JOIN math_center_series series
              ON series.id = $2
                  AND series.term_id = student.term_id
                  AND series.math_center_id = student_group.math_center_id
WHERE student.id = $1
ON CONFLICT (student_user_id, series_id)
    DO UPDATE SET can_view_video = EXCLUDED.can_view_video,
                  can_view_pdf_tex = EXCLUDED.can_view_pdf_tex,
                  updated_at = NOW();

-- name: ListStudentSeriesRazborAccessForCenter :many
-- Use the enrollment belonging to the series' term when it exists; otherwise
-- fall back to the student's current center enrollment for carried coffins.
SELECT series.id AS series_id,
       COALESCE(access.can_view_video, enrollment.razbor_default_video, enrollment.can_view_razbors, FALSE)::boolean AS can_view_video,
       COALESCE(access.can_view_pdf_tex, enrollment.razbor_default_pdf_tex, enrollment.can_view_razbors, FALSE)::boolean AS can_view_pdf_tex
FROM math_center_series series
         LEFT JOIN LATERAL (
             SELECT student.razbor_default_video,
                    student.razbor_default_pdf_tex,
                    student.can_view_razbors
             FROM math_center_students student
                      JOIN math_center_groups student_group ON student_group.id = student.group_id
                      JOIN math_center_terms term ON term.id = student.term_id
             WHERE student.user_id = $1
               AND student_group.math_center_id = series.math_center_id
             ORDER BY (student.term_id = series.term_id) DESC,
                      term.is_active DESC,
                      student.id DESC
             LIMIT 1
         ) enrollment ON TRUE
         LEFT JOIN math_center_student_series_razbor_access access
                   ON access.student_user_id = $1
                       AND access.series_id = series.id
WHERE series.math_center_id = $2
ORDER BY series.number ASC;

-- name: GetStudentSeriesRazborAccess :one
SELECT series.id AS series_id,
       COALESCE(access.can_view_video, enrollment.razbor_default_video, enrollment.can_view_razbors, FALSE)::boolean AS can_view_video,
       COALESCE(access.can_view_pdf_tex, enrollment.razbor_default_pdf_tex, enrollment.can_view_razbors, FALSE)::boolean AS can_view_pdf_tex
FROM math_center_series series
         LEFT JOIN LATERAL (
             SELECT student.razbor_default_video,
                    student.razbor_default_pdf_tex,
                    student.can_view_razbors
             FROM math_center_students student
                      JOIN math_center_groups student_group ON student_group.id = student.group_id
                      JOIN math_center_terms term ON term.id = student.term_id
             WHERE student.user_id = $1
               AND student_group.math_center_id = series.math_center_id
             ORDER BY (student.term_id = series.term_id) DESC,
                      term.is_active DESC,
                      student.id DESC
             LIMIT 1
         ) enrollment ON TRUE
         LEFT JOIN math_center_student_series_razbor_access access
                   ON access.student_user_id = $1
                       AND access.series_id = series.id
WHERE series.id = $2;

-- name: SearchUsers :many
SELECT id, username, first_name, middle_name, last_name
FROM users
WHERE username ILIKE '%' || @q::text || '%'
   OR first_name ILIKE '%' || @q::text || '%'
   OR last_name ILIKE '%' || @q::text || '%'
ORDER BY username ASC
LIMIT 20;
