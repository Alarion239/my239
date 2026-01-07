package mathcenter

type Group struct {
	ID        int64  `json:"id" db:"id"`
	CenterID  int64  `json:"center_id" db:"center_id"` // Foreign key column
	GroupName string `json:"group_name" db:"group_name"`

	// Not in the database
	center *Center `json:"-" db:"-"`
}
