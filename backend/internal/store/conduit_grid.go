package store

import (
	"context"
	"time"
)

// CenterGridTermParams scopes a center-wide Conduit read to one academic term.
// The queries intentionally start from their natural axis (roster, columns, or
// existing threads) instead of materializing the students x columns product.
type CenterGridTermParams struct {
	MathCenterID int64
	TermID       int64
}

type TeacherCenterGridRosterRow struct {
	GroupID           int64
	GroupName         string
	StudentUserID     int64
	StudentFirstName  string
	StudentLastName   string
	HasStudentComment bool
}

type TeacherCenterGridColumnRow struct {
	SeriesID         int64
	SeriesNumber     int32
	SeriesName       string
	SeriesDueAt      time.Time
	SubproblemID     int64
	SubproblemLabel  string
	ProblemID        int64
	ProblemNumber    int32
	IsCoffin         bool
	CoffinReleasedAt *time.Time
}

type TeacherCenterGridCellRow struct {
	StudentUserID      int64
	SubproblemID       int64
	ThreadID           int64
	CurrentStatus      string
	LastGraderUserID   *int64
	LastGraderName     string
	GraderFirstName    *string
	GraderLastName     *string
	ClaimHolderUserID  *int64
	ClaimExpiresAt     *time.Time
	HasInternalComment bool
}

type TeacherCenterGridSeriesCellsParams struct {
	MathCenterID int64
	SeriesID     int64
}

const teacherCenterGridRosterForTermSQL = `
SELECT g.id,
       g.name,
       mcs.user_id,
       u.first_name,
       u.last_name,
       EXISTS (
           SELECT 1
           FROM math_center_student_note csn
           WHERE csn.student_user_id = mcs.user_id
             AND csn.math_center_id = g.math_center_id
       ) AS has_student_comment
FROM math_center_groups g
JOIN math_center_students mcs ON mcs.group_id = g.id
JOIN users u ON u.id = mcs.user_id
WHERE g.math_center_id = $1
  AND g.term_id = $2
ORDER BY g.name ASC, u.last_name ASC, u.first_name ASC, mcs.user_id ASC;
`

const teacherCenterGridColumnsForTermSQL = `
SELECT s.id,
       s.number,
       s.name,
       s.due_at,
       sp.id,
       sp.label,
       p.id,
       p.number,
       COALESCE(ss.is_coffin, false)::boolean,
       ss.released_at
FROM math_center_series s
JOIN math_center_problems p ON p.series_id = s.id
JOIN math_center_subproblems sp ON sp.problem_id = p.id
LEFT JOIN math_center_subproblem_solutions ss ON ss.subproblem_id = sp.id
WHERE s.math_center_id = $1
  AND s.term_id = $2
ORDER BY s.number ASC, s.id ASC, p.number ASC, p.id ASC, sp.label ASC, sp.id ASC;
`

const teacherCenterGridCellsForTermSQL = `
SELECT t.student_user_id,
       t.subproblem_id,
       t.id,
       t.current_status,
       t.last_grader_user_id,
       COALESCE(t.last_grader_name, ''),
       gu.first_name,
       gu.last_name,
       t.claim_holder_user_id,
       t.claim_expires_at,
       EXISTS (
           SELECT 1
           FROM homework_thread_note n
           WHERE n.thread_id = t.id
       ) AS has_internal_comment
FROM homework_thread t
JOIN math_center_series s
  ON s.id = t.series_id
 AND s.math_center_id = $1
 AND s.term_id = $2
JOIN math_center_problems p ON p.series_id = s.id
JOIN math_center_subproblems sp
  ON sp.problem_id = p.id
 AND sp.id = t.subproblem_id
JOIN math_center_students mcs
  ON mcs.user_id = t.student_user_id
 AND mcs.term_id = s.term_id
JOIN math_center_groups g
  ON g.id = mcs.group_id
 AND g.math_center_id = s.math_center_id
LEFT JOIN users gu ON gu.id = t.last_grader_user_id
WHERE t.math_center_id = $1;
`

const teacherCenterGridCellsForSeriesSQL = `
SELECT t.student_user_id,
       t.subproblem_id,
       t.id,
       t.current_status,
       t.last_grader_user_id,
       COALESCE(t.last_grader_name, ''),
       gu.first_name,
       gu.last_name,
       t.claim_holder_user_id,
       t.claim_expires_at,
       EXISTS (
           SELECT 1
           FROM homework_thread_note n
           WHERE n.thread_id = t.id
       ) AS has_internal_comment
FROM homework_thread t
JOIN math_center_series s
  ON s.id = t.series_id
 AND s.math_center_id = $1
 AND s.id = $2
JOIN math_center_problems p ON p.series_id = s.id
JOIN math_center_subproblems sp
  ON sp.problem_id = p.id
 AND sp.id = t.subproblem_id
JOIN math_center_students mcs
  ON mcs.user_id = t.student_user_id
 AND mcs.term_id = s.term_id
JOIN math_center_groups g
  ON g.id = mcs.group_id
 AND g.math_center_id = s.math_center_id
LEFT JOIN users gu ON gu.id = t.last_grader_user_id
WHERE t.math_center_id = $1;
`

func (q *Queries) TeacherCenterGridRosterForTerm(ctx context.Context, arg CenterGridTermParams) ([]TeacherCenterGridRosterRow, error) {
	rows, err := q.db.Query(ctx, teacherCenterGridRosterForTermSQL, arg.MathCenterID, arg.TermID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]TeacherCenterGridRosterRow, 0)
	for rows.Next() {
		var item TeacherCenterGridRosterRow
		if err := rows.Scan(
			&item.GroupID,
			&item.GroupName,
			&item.StudentUserID,
			&item.StudentFirstName,
			&item.StudentLastName,
			&item.HasStudentComment,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (q *Queries) TeacherCenterGridColumnsForTerm(ctx context.Context, arg CenterGridTermParams) ([]TeacherCenterGridColumnRow, error) {
	rows, err := q.db.Query(ctx, teacherCenterGridColumnsForTermSQL, arg.MathCenterID, arg.TermID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]TeacherCenterGridColumnRow, 0)
	for rows.Next() {
		var item TeacherCenterGridColumnRow
		if err := rows.Scan(
			&item.SeriesID,
			&item.SeriesNumber,
			&item.SeriesName,
			&item.SeriesDueAt,
			&item.SubproblemID,
			&item.SubproblemLabel,
			&item.ProblemID,
			&item.ProblemNumber,
			&item.IsCoffin,
			&item.CoffinReleasedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (q *Queries) TeacherCenterGridCellsForTerm(ctx context.Context, arg CenterGridTermParams) ([]TeacherCenterGridCellRow, error) {
	return q.teacherCenterGridCells(ctx, teacherCenterGridCellsForTermSQL, arg.MathCenterID, arg.TermID)
}

func (q *Queries) TeacherCenterGridCellsForSeries(ctx context.Context, arg TeacherCenterGridSeriesCellsParams) ([]TeacherCenterGridCellRow, error) {
	return q.teacherCenterGridCells(ctx, teacherCenterGridCellsForSeriesSQL, arg.MathCenterID, arg.SeriesID)
}

func (q *Queries) teacherCenterGridCells(ctx context.Context, query string, firstArg, secondArg int64) ([]TeacherCenterGridCellRow, error) {
	rows, err := q.db.Query(ctx, query, firstArg, secondArg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]TeacherCenterGridCellRow, 0)
	for rows.Next() {
		var item TeacherCenterGridCellRow
		if err := rows.Scan(
			&item.StudentUserID,
			&item.SubproblemID,
			&item.ThreadID,
			&item.CurrentStatus,
			&item.LastGraderUserID,
			&item.LastGraderName,
			&item.GraderFirstName,
			&item.GraderLastName,
			&item.ClaimHolderUserID,
			&item.ClaimExpiresAt,
			&item.HasInternalComment,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
