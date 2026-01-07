package mathcenter

import (
	"context"
	"fmt"

	"github.com/Alarion239/my239/backend/models/mathcenter"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

func GetCenterByID(ctx context.Context, db *db.DB, id int64) (*mathcenter.Center, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	center := &mathcenter.Center{}
	err := db.Pool().QueryRow(ctx, "SELECT id, graduation_year FROM mathcenter.centers WHERE id = $1", id).Scan(&center.ID, &center.GraduationYear)
	switch err {
	case pgx.ErrNoRows:
		return nil, nil
	case nil:
		return center, nil
	default:
		return nil, fmt.Errorf("failed to get center: %w", err)
	}
}

func GetCenterByGraduationYear(ctx context.Context, db *db.DB, graduationYear int64) (*mathcenter.Center, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	center := &mathcenter.Center{}
	err := db.Pool().QueryRow(ctx, "SELECT id, graduation_year FROM mathcenter.centers WHERE graduation_year = $1", graduationYear).Scan(&center.ID, &center.GraduationYear)
	switch err {
	case pgx.ErrNoRows:
		return nil, nil
	case nil:
		return center, nil
	default:
		return nil, fmt.Errorf("failed to get center: %w", err)
	}
}
