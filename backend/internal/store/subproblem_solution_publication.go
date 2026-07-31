package store

// This file contains the small publication-specific query surface which is
// intentionally kept separate from the generated sqlc file. The generated
// queries predate drafts and remain usable by older callers; these queries
// select the new nullable publication timestamp explicitly.

import (
	"context"
	"time"
)

const subproblemSolutionWithPublicationSQL = `
SELECT id, subproblem_id, is_coffin, released_at,
       solution_tex_source, solution_pdf_object_key, solution_link,
       created_at, updated_at, solution_group_id, published_at
FROM math_center_subproblem_solutions
WHERE subproblem_id = $1
`

func (q *Queries) GetSubproblemSolutionWithPublication(ctx context.Context, subproblemID int64) (MathCenterSubproblemSolution, error) {
	row := q.db.QueryRow(ctx, subproblemSolutionWithPublicationSQL, subproblemID)
	var out MathCenterSubproblemSolution
	err := row.Scan(
		&out.ID, &out.SubproblemID, &out.IsCoffin, &out.ReleasedAt,
		&out.SolutionTexSource, &out.SolutionPdfObjectKey, &out.SolutionLink,
		&out.CreatedAt, &out.UpdatedAt, &out.SolutionGroupID, &out.PublishedAt,
	)
	return out, err
}

const setSubproblemSolutionTexWithPublicationSQL = `
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_tex_source)
VALUES ($1, $2)
ON CONFLICT (subproblem_id) DO UPDATE SET
    solution_tex_source = EXCLUDED.solution_tex_source,
    updated_at = NOW()
RETURNING id, subproblem_id, is_coffin, released_at,
          solution_tex_source, solution_pdf_object_key, solution_link,
          created_at, updated_at, solution_group_id, published_at
`

func (q *Queries) SetSubproblemSolutionTexWithPublication(ctx context.Context, subproblemID int64, tex *string) (MathCenterSubproblemSolution, error) {
	row := q.db.QueryRow(ctx, setSubproblemSolutionTexWithPublicationSQL, subproblemID, tex)
	return scanPublishedSolution(row)
}

const setSubproblemSolutionPdfWithPublicationSQL = `
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_pdf_object_key)
VALUES ($1, $2)
ON CONFLICT (subproblem_id) DO UPDATE SET
    solution_pdf_object_key = EXCLUDED.solution_pdf_object_key,
    updated_at = NOW()
RETURNING id, subproblem_id, is_coffin, released_at,
          solution_tex_source, solution_pdf_object_key, solution_link,
          created_at, updated_at, solution_group_id, published_at
`

func (q *Queries) SetSubproblemSolutionPdfWithPublication(ctx context.Context, subproblemID int64, key *string) (MathCenterSubproblemSolution, error) {
	row := q.db.QueryRow(ctx, setSubproblemSolutionPdfWithPublicationSQL, subproblemID, key)
	return scanPublishedSolution(row)
}

const setSubproblemSolutionLinkWithPublicationSQL = `
INSERT INTO math_center_subproblem_solutions (subproblem_id, solution_link)
VALUES ($1, $2)
ON CONFLICT (subproblem_id) DO UPDATE SET
    solution_link = EXCLUDED.solution_link,
    updated_at = NOW()
RETURNING id, subproblem_id, is_coffin, released_at,
          solution_tex_source, solution_pdf_object_key, solution_link,
          created_at, updated_at, solution_group_id, published_at
`

func (q *Queries) SetSubproblemSolutionLinkWithPublication(ctx context.Context, subproblemID int64, link *string) (MathCenterSubproblemSolution, error) {
	row := q.db.QueryRow(ctx, setSubproblemSolutionLinkWithPublicationSQL, subproblemID, link)
	return scanPublishedSolution(row)
}

const upsertCoffinFlagWithPublicationSQL = `
INSERT INTO math_center_subproblem_solutions (subproblem_id, is_coffin)
VALUES ($1, $2)
ON CONFLICT (subproblem_id) DO UPDATE SET
    is_coffin = EXCLUDED.is_coffin,
    updated_at = NOW()
RETURNING id, subproblem_id, is_coffin, released_at,
          solution_tex_source, solution_pdf_object_key, solution_link,
          created_at, updated_at, solution_group_id, published_at
`

func (q *Queries) UpsertCoffinFlagWithPublication(ctx context.Context, subproblemID int64, isCoffin bool) (MathCenterSubproblemSolution, error) {
	row := q.db.QueryRow(ctx, upsertCoffinFlagWithPublicationSQL, subproblemID, isCoffin)
	return scanPublishedSolution(row)
}

type publishedSolutionRow interface {
	Scan(dest ...any) error
}

func scanPublishedSolution(row publishedSolutionRow) (MathCenterSubproblemSolution, error) {
	var out MathCenterSubproblemSolution
	err := row.Scan(
		&out.ID, &out.SubproblemID, &out.IsCoffin, &out.ReleasedAt,
		&out.SolutionTexSource, &out.SolutionPdfObjectKey, &out.SolutionLink,
		&out.CreatedAt, &out.UpdatedAt, &out.SolutionGroupID, &out.PublishedAt,
	)
	return out, err
}

// SolutionPublicationTarget is the locked state used by the transactional
// publish endpoint. Material presence is evaluated in SQL so a target can
// never be published between validation and the final UPDATE.
type SolutionPublicationTarget struct {
	SubproblemID int64
	MathCenterID int64
	SeriesID     int64
	IsCoffin     bool
	HasMaterial  bool
	GroupID      *int64
}

const lockSolutionPublicationTargetsSQL = `
SELECT ss.subproblem_id,
       s.math_center_id,
       s.id AS series_id,
       ss.is_coffin,
       (ss.solution_tex_source IS NOT NULL
         OR ss.solution_pdf_object_key IS NOT NULL
         OR ss.solution_link IS NOT NULL)::boolean AS has_material,
       ss.solution_group_id
FROM math_center_subproblem_solutions ss
JOIN math_center_subproblems sp ON sp.id = ss.subproblem_id
JOIN math_center_problems p ON p.id = sp.problem_id
JOIN math_center_series s ON s.id = p.series_id
WHERE ss.subproblem_id = ANY($1::bigint[])
FOR UPDATE OF ss
`

func (q *Queries) LockSolutionPublicationTargets(ctx context.Context, ids []int64) ([]SolutionPublicationTarget, error) {
	rows, err := q.db.Query(ctx, lockSolutionPublicationTargetsSQL, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SolutionPublicationTarget, 0, len(ids))
	for rows.Next() {
		var row SolutionPublicationTarget
		if err := rows.Scan(&row.SubproblemID, &row.MathCenterID, &row.SeriesID, &row.IsCoffin, &row.HasMaterial, &row.GroupID); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

type PublishedSolutionResult struct {
	SubproblemID int64
	IsCoffin     bool
	PublishedAt  time.Time
}

const publishSolutionsSQL = `
UPDATE math_center_subproblem_solutions
SET published_at = $2,
    released_at = CASE
        WHEN is_coffin THEN COALESCE(released_at, $2)
        ELSE released_at
    END,
    updated_at = NOW()
WHERE subproblem_id = ANY($1::bigint[])
RETURNING subproblem_id, is_coffin, published_at
`

func (q *Queries) PublishSolutions(ctx context.Context, ids []int64, publishedAt time.Time) ([]PublishedSolutionResult, error) {
	rows, err := q.db.Query(ctx, publishSolutionsSQL, ids, publishedAt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PublishedSolutionResult, 0, len(ids))
	for rows.Next() {
		var row PublishedSolutionResult
		if err := rows.Scan(&row.SubproblemID, &row.IsCoffin, &row.PublishedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
