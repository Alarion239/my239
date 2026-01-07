package mathcenter

import "github.com/Alarion239/my239/backend/models/common"

type Teacher struct {
	ID           int64 `json:"id" db:"id"`
	CommonUserID int64 `json:"common_user_id" db:"common_user_id"` // Foreign key
	CenterID     int64 `json:"center_id" db:"center_id"`           // Foreign key

	// Not in the database
	commonUser *common.User `json:"-" db:"-"`
	center     *Center      `json:"-" db:"-"`
}
