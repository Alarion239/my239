package mathcenter

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var (
	bootstrapCenterColumns = []string{"id", "graduation_year", "created_at"}
	bootstrapTermColumns   = []string{
		"id", "math_center_id", "kind", "grade", "is_active", "created_at", "archived_at",
	}
	bootstrapGroupColumns = []string{"id", "math_center_id", "name", "created_at", "term_id"}
)

func TestCreateCenterWithInitialTerm(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	grade := int32(5)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO math_centers`).
		WithArgs(int32(2032)).
		WillReturnRows(mock.NewRows(bootstrapCenterColumns).
			AddRow(int64(12), int32(2032), now))
	mock.ExpectQuery(`INSERT INTO math_center_terms`).
		WithArgs(int64(12), TermKindAcademic, pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(bootstrapTermColumns).
			AddRow(int64(21), int64(12), TermKindAcademic, &grade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(21), UnassignedGroupName).
		WillReturnRows(mock.NewRows(bootstrapGroupColumns).
			AddRow(int64(31), int64(12), UnassignedGroupName, now, int64(21)))
	mock.ExpectCommit()

	center, err := CreateCenterWithInitialTerm(
		context.Background(), mock, 2032, TermKindAcademic, 5,
	)
	if err != nil {
		t.Fatalf("CreateCenterWithInitialTerm() error = %v", err)
	}
	if center.ID != 12 {
		t.Fatalf("center id = %d, want 12", center.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestCreateCenterWithInitialTermAcceptsPastTerm(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	grade := int32(5)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO math_centers`).
		WithArgs(int32(2026)).
		WillReturnRows(mock.NewRows(bootstrapCenterColumns).
			AddRow(int64(12), int32(2026), now))
	mock.ExpectQuery(`INSERT INTO math_center_terms`).
		WithArgs(int64(12), TermKindAcademic, pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(bootstrapTermColumns).
			AddRow(int64(21), int64(12), TermKindAcademic, &grade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(21), UnassignedGroupName).
		WillReturnRows(mock.NewRows(bootstrapGroupColumns).
			AddRow(int64(31), int64(12), UnassignedGroupName, now, int64(21)))
	mock.ExpectCommit()

	if _, err := CreateCenterWithInitialTerm(
		context.Background(), mock, 2026, TermKindAcademic, 5,
	); err != nil {
		t.Fatalf("CreateCenterWithInitialTerm() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestCreateGroupForCurrentTermRepairsCenterWithoutTerms(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	grade := int32(5)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT graduation_year FROM math_centers`).
		WithArgs(int64(12)).
		WillReturnRows(mock.NewRows([]string{"graduation_year"}).AddRow(int32(2032)))
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+AND is_active = TRUE`).
		WithArgs(int64(12)).
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectQuery(`FROM math_center_terms\s+WHERE math_center_id = \$1\s+AND kind = 'legacy'`).
		WithArgs(int64(12)).
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectQuery(`INSERT INTO math_center_terms`).
		WithArgs(int64(12), TermKindAcademic, pgxmock.AnyArg()).
		WillReturnRows(mock.NewRows(bootstrapTermColumns).
			AddRow(int64(21), int64(12), TermKindAcademic, &grade, true, now, (*time.Time)(nil)))
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(21), UnassignedGroupName).
		WillReturnRows(mock.NewRows(bootstrapGroupColumns).
			AddRow(int64(30), int64(12), UnassignedGroupName, now, int64(21)))
	mock.ExpectQuery(`INSERT INTO math_center_groups`).
		WithArgs(int64(21), "А").
		WillReturnRows(mock.NewRows(bootstrapGroupColumns).
			AddRow(int64(31), int64(12), "А", now, int64(21)))
	mock.ExpectCommit()

	group, err := CreateGroupForCurrentTerm(context.Background(), mock, 12, "А", now)
	if err != nil {
		t.Fatalf("CreateGroupForCurrentTerm() error = %v", err)
	}
	if group.ID != 31 || group.Name != "А" {
		t.Fatalf("group = %#v", group)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled expectations: %v", err)
	}
}

func TestCurrentMathCenterGradeRejectsIneligibleCohort(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	if _, err := currentMathCenterGrade(2033, now); err == nil {
		t.Fatal("fourth-grade cohort must be rejected")
	}
}
