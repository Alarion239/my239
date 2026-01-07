package mathcenter

import "github.com/Alarion239/my239/backend/models/common"

type Student struct {
	ID           int64 `json:"id" db:"id"`
	CommonUserID int64 `json:"common_user_id" db:"common_user_id"` // Foreign key
	GroupID      int64 `json:"group_id" db:"group_id"`             // Foreign key

	// Not in the database
	commonUser *common.User `json:"-" db:"-"`
	group      *Group       `json:"-" db:"-"`
}
