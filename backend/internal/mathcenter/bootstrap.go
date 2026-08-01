package mathcenter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

var (
	ErrCohortOutsideMathCenterGrades = errors.New("cohort is not currently in grades 5–11")
	ErrInvalidInitialTerm            = errors.New("invalid initial math center term")
	ErrReservedGroupName             = errors.New("reserved math center group name")
)

// CreateCenterWithInitialTerm creates a usable center in one transaction. A
// center without a term cannot accept groups because every roster is
// term-scoped.
func CreateCenterWithInitialTerm(
	ctx context.Context,
	pool db.Pool,
	graduationYear int32,
	termKind string,
	termGrade int32,
) (store.MathCenter, error) {
	if _, valid := TermStage(termKind, termGrade); !valid {
		return store.MathCenter{}, ErrInvalidInitialTerm
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return store.MathCenter{}, fmt.Errorf("beginning math center creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := store.New(tx)
	center, err := q.CreateMathCenter(ctx, graduationYear)
	if err != nil {
		return store.MathCenter{}, fmt.Errorf("creating math center: %w", err)
	}
	term, err := q.CreateMathCenterTerm(ctx, store.CreateMathCenterTermParams{
		MathCenterID: center.ID,
		Kind:         termKind,
		Grade:        &termGrade,
	})
	if err != nil {
		return store.MathCenter{}, fmt.Errorf("creating initial math center term: %w", err)
	}
	if _, err := q.CreateMathCenterGroupForTerm(ctx, store.CreateMathCenterGroupForTermParams{
		ID: term.ID, Name: UnassignedGroupName,
	}); err != nil {
		return store.MathCenter{}, fmt.Errorf("creating initial unassigned group: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return store.MathCenter{}, fmt.Errorf("committing math center creation: %w", err)
	}
	return center, nil
}

// CreateGroupForCurrentTerm creates a group in the active term, falling back
// to a legacy term for migrated centers. It also repairs centers created by
// older code that left them without any term.
func CreateGroupForCurrentTerm(
	ctx context.Context,
	pool db.Pool,
	centerID int64,
	name string,
	now time.Time,
) (store.CreateMathCenterGroupRow, error) {
	if IsUnassignedGroupName(name) {
		return store.CreateMathCenterGroupRow{}, ErrReservedGroupName
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return store.CreateMathCenterGroupRow{}, fmt.Errorf("beginning group creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialize first-time setup for this center, so two simultaneous group
	// requests cannot both try to create the one allowed active term.
	var graduationYear int32
	if err := tx.QueryRow(ctx, `SELECT graduation_year FROM math_centers
		WHERE id = $1 FOR UPDATE`, centerID).Scan(&graduationYear); err != nil {
		return store.CreateMathCenterGroupRow{}, fmt.Errorf("locking math center: %w", err)
	}

	q := store.New(tx)
	createdTerm := false
	term, err := q.GetActiveTermForCenter(ctx, centerID)
	if errors.Is(err, pgx.ErrNoRows) {
		term, err = q.GetLegacyTermForCenter(ctx, centerID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		grade, gradeErr := currentMathCenterGrade(graduationYear, now)
		if gradeErr != nil {
			return store.CreateMathCenterGroupRow{}, gradeErr
		}
		term, err = q.CreateMathCenterTerm(ctx, store.CreateMathCenterTermParams{
			MathCenterID: centerID,
			Kind:         TermKindAcademic,
			Grade:        &grade,
		})
		createdTerm = err == nil
	}
	if err != nil {
		return store.CreateMathCenterGroupRow{}, fmt.Errorf("resolving group term: %w", err)
	}
	if createdTerm {
		if _, err := q.CreateMathCenterGroupForTerm(ctx, store.CreateMathCenterGroupForTermParams{
			ID: term.ID, Name: UnassignedGroupName,
		}); err != nil {
			return store.CreateMathCenterGroupRow{}, fmt.Errorf("creating unassigned group: %w", err)
		}
	}
	group, err := q.CreateMathCenterGroupForTerm(ctx, store.CreateMathCenterGroupForTermParams{
		ID: term.ID, Name: name,
	})
	if err != nil {
		return store.CreateMathCenterGroupRow{}, fmt.Errorf("creating group: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return store.CreateMathCenterGroupRow{}, fmt.Errorf("committing group creation: %w", err)
	}
	return store.CreateMathCenterGroupRow{
		ID: group.ID, MathCenterID: group.MathCenterID,
		Name: group.Name, CreatedAt: group.CreatedAt,
	}, nil
}

func currentMathCenterGrade(graduationYear int32, now time.Time) (int32, error) {
	grade := int32(Grade(int(graduationYear), now))
	if grade < 5 || grade > 11 {
		return 0, ErrCohortOutsideMathCenterGrades
	}
	return grade, nil
}
