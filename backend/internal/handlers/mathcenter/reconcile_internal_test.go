package mathcenter

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/internal/store"
)

// Growing a problem's subparts (a,b → a,b,c) must KEEP a and b (so their
// threads/разборы/coffins survive) and only insert c. Shrinking deletes only
// the surplus. reconcileSubproblems keys on the label, not position.
func TestReconcileSubproblems_GrowKeepsSiblings(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	q := store.New(mock)

	existing := []subIdent{{ID: 700, Label: "a"}, {ID: 701, Label: "b"}}
	// Only c is created; a and b are untouched (no delete, no re-insert).
	mock.ExpectQuery(`INSERT INTO math_center_subproblems`).
		WithArgs(int64(500), "c").
		WillReturnRows(mock.NewRows([]string{"id", "problem_id", "label", "created_at"}).
			AddRow(int64(702), int64(500), "c", nil))

	if err := reconcileSubproblems(context.Background(), q, 500, existing, 3); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestReconcileSubproblems_ShrinkDeletesSurplus(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	q := store.New(mock)

	existing := []subIdent{{ID: 700, Label: "a"}, {ID: 701, Label: "b"}, {ID: 702, Label: "c"}}
	// Going to count 2 deletes only c; a and b stay.
	mock.ExpectExec(`DELETE\s+FROM math_center_subproblems WHERE id`).
		WithArgs(int64(702)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	if err := reconcileSubproblems(context.Background(), q, 500, existing, 2); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// No structural change ⇒ no writes at all (the common edit: just a renamed
// series or a new due date leaves every subproblem untouched).
func TestReconcileSubproblems_NoChangeNoWrites(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	q := store.New(mock)

	existing := []subIdent{{ID: 700, Label: "a"}, {ID: 701, Label: "b"}}
	if err := reconcileSubproblems(context.Background(), q, 500, existing, 2); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected queries issued: %v", err)
	}
}
