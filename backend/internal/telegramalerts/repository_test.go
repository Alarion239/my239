package telegramalerts

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func TestRepositoryConsumeEnrollmentSessionIsOneUse(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectQuery(`DELETE FROM telegram_alert_enrollment_sessions`).
		WithArgs(int64(17), int64(274239)).
		WillReturnRows(pgxmock.NewRows([]string{"telegram_user_id"}).AddRow(int64(17)))

	repo := NewRepository(mock)
	if err := repo.ConsumeEnrollmentSession(context.Background(), 17, 274239); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryConsumeEnrollmentSessionRejectsMissingOrExpired(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectQuery(`DELETE FROM telegram_alert_enrollment_sessions`).
		WithArgs(int64(17), int64(274239)).
		WillReturnError(pgx.ErrNoRows)

	repo := NewRepository(mock)
	if err := repo.ConsumeEnrollmentSession(context.Background(), 17, 274239); !errors.Is(err, ErrEnrollmentSessionInvalid) {
		t.Fatalf("error: got %v, want ErrEnrollmentSessionInvalid", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryUpsertReenablesDisabledSubscription(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectExec(`INSERT INTO telegram_alert_subscriptions`).
		WithArgs(int64(-100), "supergroup", int64(17)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	repo := NewRepository(mock)
	if err := repo.UpsertSubscription(context.Background(), -100, "supergroup", 17); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRepositoryListActiveSubscriptionsMapsRows(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	now := time.Now().UTC()
	mock.ExpectQuery(`SELECT chat_id, chat_type, subscribed_by_user_id`).
		WillReturnRows(pgxmock.NewRows([]string{
			"chat_id", "chat_type", "subscribed_by_user_id", "created_at", "updated_at", "disabled_at",
		}).AddRow(int64(42), "private", int64(17), now, now, nil))

	repo := NewRepository(mock)
	subs, err := repo.ListActiveSubscriptions(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(subs) != 1 || subs[0].ChatID != 42 || subs[0].SubscribedByUser != 17 {
		t.Fatalf("subscriptions: %#v", subs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
