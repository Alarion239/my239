package tokenpreset_test

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/internal/tokenpreset"
)

// compile-time check that the generated *store.Queries satisfies the
// tokenpreset.Store interface — this is the type passed at the real call sites.
var _ tokenpreset.Store = (*store.Queries)(nil)

// TestApply_AgainstStoreQueries drives Apply through a real *store.Queries
// backed by pgxmock, asserting the SQL it issues for a teacher-grant preset:
// GetMathCenter (center-exists) → IsStudentInCenter (exclusivity guard) →
// AddTeacherToCenter, in that order.
func TestApply_AgainstStoreQueries(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`SELECT .* FROM math_centers WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnRows(mock.NewRows([]string{"id", "graduation_year", "created_at"}).
			AddRow(int64(7), int32(2030), now))
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(int64(42), int64(7)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))
	mock.ExpectQuery(`INSERT INTO math_center_teachers`).
		WithArgs(int64(42), int64(7), true).
		WillReturnRows(mock.NewRows([]string{"id", "user_id", "math_center_id", "is_head_teacher", "created_at"}).
			AddRow(int64(1), int64(42), int64(7), true, now))

	q := store.New(mock)
	preset := tokenpreset.Preset{
		MathCenterTeacher: &tokenpreset.MathCenterTeacher{CenterID: 7, IsHeadTeacher: true},
	}
	if err := tokenpreset.Apply(context.Background(), q, 42, preset); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}
