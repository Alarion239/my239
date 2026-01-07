package mathcenter

type Center struct {
	ID             int64 `json:"id" db:"id"`
	GraduationYear int   `json:"graduation_year" db:"graduation_year"`
}
