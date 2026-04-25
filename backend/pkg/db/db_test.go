package db_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/Alarion239/my239/backend/pkg/db"
)

// TestNewDBWithPool verifies that a DB can be constructed from an arbitrary Pool
// implementation, which is the primary entry-point for test doubles.
func TestNewDBWithPool(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	database := db.NewDBWithPool(mock)
	if database == nil {
		t.Fatal("expected non-nil *DB")
	}
	if database.Pool() == nil {
		t.Fatal("expected non-nil Pool from DB.Pool()")
	}
}

// TestDB_Pool_IsTheSameMock checks that Pool() returns the exact mock injected.
func TestDB_Pool_IsTheSameMock(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	database := db.NewDBWithPool(mock)
	if database.Pool() != mock {
		t.Error("DB.Pool() did not return the injected mock")
	}
}

// TestDB_Close calls Close on the DB and confirms that the underlying pool
// Close is invoked exactly once.
func TestDB_Close(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}

	mock.ExpectClose()

	database := db.NewDBWithPool(mock)
	database.Close()

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations after Close: %v", err)
	}
}

// TestDB_Pool_Ping verifies that a Ping call through the Pool interface is
// forwarded to the underlying connection and succeeds.
func TestDB_Pool_Ping(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectPing()

	database := db.NewDBWithPool(mock)
	if err := database.Pool().Ping(context.Background()); err != nil {
		t.Errorf("unexpected Ping error: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_Ping_Error verifies that a Ping error is propagated correctly.
func TestDB_Pool_Ping_Error(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	pingErr := errors.New("connection refused")
	mock.ExpectPing().WillReturnError(pingErr)

	database := db.NewDBWithPool(mock)
	if err := database.Pool().Ping(context.Background()); !errors.Is(err, pingErr) {
		t.Errorf("expected ping error %q, got %v", pingErr, err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_QueryRow checks that QueryRow forwards the query and returns the
// scanned result through the Pool interface.
func TestDB_Pool_QueryRow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	wantID := int64(42)
	wantUsername := "sasha"
	rows := mock.NewRows([]string{"id", "username"}).
		AddRow(wantID, wantUsername)
	mock.ExpectQuery(`SELECT id, username FROM common\.users WHERE id = \$1`).
		WithArgs(wantID).
		WillReturnRows(rows)

	database := db.NewDBWithPool(mock)

	var gotID int64
	var gotUsername string
	err = database.Pool().
		QueryRow(context.Background(), `SELECT id, username FROM common.users WHERE id = $1`, wantID).
		Scan(&gotID, &gotUsername)
	if err != nil {
		t.Fatalf("unexpected QueryRow error: %v", err)
	}
	if gotID != wantID {
		t.Errorf("ID: want %d, got %d", wantID, gotID)
	}
	if gotUsername != wantUsername {
		t.Errorf("username: want %q, got %q", wantUsername, gotUsername)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_Query checks that Query returns multiple rows through the Pool
// interface.
func TestDB_Pool_Query(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	rows := mock.NewRows([]string{"id", "description", "max_uses", "expires_at", "created_at"}).
		AddRow(int64(1), "admin invite", 5, time.Now().Add(24*time.Hour), time.Now()).
		AddRow(int64(2), "student invite", 10, time.Now().Add(48*time.Hour), time.Now())
	mock.ExpectQuery(`SELECT id, description, max_uses, expires_at, created_at FROM authorize\.invitation_tokens`).
		WillReturnRows(rows)

	database := db.NewDBWithPool(mock)

	pgxRows, err := database.Pool().Query(
		context.Background(),
		`SELECT id, description, max_uses, expires_at, created_at FROM authorize.invitation_tokens`,
	)
	if err != nil {
		t.Fatalf("unexpected Query error: %v", err)
	}
	defer pgxRows.Close()

	count := 0
	for pgxRows.Next() {
		var (
			id          int64
			description string
			maxUses     int
			expiresAt   time.Time
			createdAt   time.Time
		)
		if err := pgxRows.Scan(&id, &description, &maxUses, &expiresAt, &createdAt); err != nil {
			t.Fatalf("scan row %d: %v", count, err)
		}
		count++
	}
	if err := pgxRows.Err(); err != nil {
		t.Fatalf("rows iteration error: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 rows, got %d", count)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_Exec_RowsAffected verifies that Exec returns the correct
// CommandTag (rows-affected count) through the Pool interface.
func TestDB_Pool_Exec_RowsAffected(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectExec(`UPDATE authorize\.invitation_tokens SET expires_at = NOW\(\) WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	database := db.NewDBWithPool(mock)

	tag, err := database.Pool().Exec(
		context.Background(),
		`UPDATE authorize.invitation_tokens SET expires_at = NOW() WHERE id = $1`,
		int64(7),
	)
	if err != nil {
		t.Fatalf("unexpected Exec error: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Errorf("expected 1 row affected, got %d", tag.RowsAffected())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_Exec_Error confirms that Exec propagates database errors.
func TestDB_Pool_Exec_Error(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	dbErr := &pgconn.PgError{Code: "23505", Message: "duplicate key value"}
	mock.ExpectExec(`INSERT INTO common\.users`).
		WithArgs("duplicate_user").
		WillReturnError(dbErr)

	database := db.NewDBWithPool(mock)

	_, err = database.Pool().Exec(
		context.Background(),
		`INSERT INTO common.users (username) VALUES ($1)`,
		"duplicate_user",
	)
	if err == nil {
		t.Fatal("expected an error but got nil")
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Errorf("expected PgError 23505, got: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestDB_Pool_Begin verifies that a transaction can be started through the
// Pool interface.
func TestDB_Pool_Begin(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectBegin()
	mock.ExpectRollback()

	database := db.NewDBWithPool(mock)

	tx, err := database.Pool().Begin(context.Background())
	if err != nil {
		t.Fatalf("unexpected Begin error: %v", err)
	}
	// Roll back to satisfy the expectation.
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("unexpected Rollback error: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// TestNewDB_CancelledContext confirms that NewDB returns an error immediately
// when a cancelled context is provided, without attempting a connection.
func TestNewDB_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // pre-cancel

	_, err := db.NewDB(ctx, "postgres://localhost/test")
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled in error chain, got: %v", err)
	}
}
