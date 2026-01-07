package mathcenter

import (
	"context"
	"fmt"

	"github.com/Alarion239/my239/backend/models/mathcenter"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/jackc/pgx/v5"
)

func GetGroupByID(ctx context.Context, db *db.DB, id int64) (*mathcenter.Group, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	group := &mathcenter.Group{}
	err := db.Pool().QueryRow(ctx, "SELECT id, center_id, group_name FROM mathcenter.groups WHERE id = $1", id).Scan(&group.ID, &group.CenterID, &group.GroupName)
	switch err {
	case pgx.ErrNoRows:
		return nil, nil
	case nil:
		return group, nil
	default:
		return nil, fmt.Errorf("failed to get group: %w", err)
	}
}

func GetGroupByCenterIDAndGroupName(ctx context.Context, db *db.DB, center *mathcenter.Center, groupName string) (*mathcenter.Group, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	group := &mathcenter.Group{}
	err := db.Pool().QueryRow(ctx, "SELECT id, center_id, group_name FROM mathcenter.groups WHERE center_id = $1 AND group_name = $2", center.ID, groupName).Scan(&group.ID, &group.CenterID, &group.GroupName)
	switch err {
	case pgx.ErrNoRows:
		return nil, nil
	case nil:
		return group, nil
	default:
		return nil, fmt.Errorf("failed to get group: %w", err)
	}
}
