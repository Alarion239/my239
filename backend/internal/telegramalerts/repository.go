package telegramalerts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Alarion239/my239/backend/internal/store"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Repository owns the small PostgreSQL state machine used by bot enrollment
// and delivery. It deliberately stores Telegram identifiers only; display
// names and credentials never enter the database.
type Repository struct {
	q *store.Queries
}

func NewRepository(q db.Querier) *Repository {
	return &Repository{q: store.New(q)}
}

type Subscription struct {
	ChatID           int64
	ChatType         string
	SubscribedByUser int64
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DisabledAt       *time.Time
}

func (r *Repository) ListActiveSubscriptions(ctx context.Context) ([]Subscription, error) {
	rows, err := r.q.ListActiveTelegramAlertSubscriptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("list telegram alert subscriptions: %w", err)
	}
	result := make([]Subscription, 0, len(rows))
	for _, row := range rows {
		result = append(result, subscriptionFromStore(row))
	}
	return result, nil
}

func (r *Repository) GetSubscription(ctx context.Context, chatID int64) (Subscription, error) {
	s, err := r.q.GetTelegramAlertSubscription(ctx, chatID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Subscription{}, ErrSubscriptionNotFound
		}
		return Subscription{}, fmt.Errorf("get telegram alert subscription: %w", err)
	}
	return subscriptionFromStore(s), nil
}

var ErrSubscriptionNotFound = errors.New("telegram alert subscription not found")

func (r *Repository) UpsertSubscription(ctx context.Context, chatID int64, chatType string, subscribedByUser int64) error {
	err := r.q.UpsertTelegramAlertSubscription(ctx, store.UpsertTelegramAlertSubscriptionParams{
		ChatID:             chatID,
		ChatType:           chatType,
		SubscribedByUserID: subscribedByUser,
	})
	if err != nil {
		return fmt.Errorf("upsert telegram alert subscription: %w", err)
	}
	return nil
}

func (r *Repository) DeleteSubscription(ctx context.Context, chatID int64) error {
	err := r.q.DeleteTelegramAlertSubscription(ctx, chatID)
	if err != nil {
		return fmt.Errorf("delete telegram alert subscription: %w", err)
	}
	return nil
}

func (r *Repository) DisableSubscription(ctx context.Context, chatID int64) error {
	err := r.q.DisableTelegramAlertSubscription(ctx, chatID)
	if err != nil {
		return fmt.Errorf("disable telegram alert subscription: %w", err)
	}
	return nil
}

func (r *Repository) CreateEnrollmentSession(ctx context.Context, telegramUserID, requestID int64, expiresAt time.Time) error {
	err := r.q.CreateTelegramAlertEnrollmentSession(ctx, store.CreateTelegramAlertEnrollmentSessionParams{
		TelegramUserID: telegramUserID,
		RequestID:      requestID,
		ExpiresAt:      expiresAt,
	})
	if err != nil {
		return fmt.Errorf("create telegram alert enrollment session: %w", err)
	}
	return nil
}

// ConsumeEnrollmentSession atomically deletes and returns a valid session.
// This makes the group-picker request one-use even when Telegram retries a
// webhook or multiple backend replicas receive concurrent updates.
func (r *Repository) ConsumeEnrollmentSession(ctx context.Context, telegramUserID, requestID int64) error {
	_, err := r.q.ConsumeTelegramAlertEnrollmentSession(ctx, store.ConsumeTelegramAlertEnrollmentSessionParams{
		TelegramUserID: telegramUserID,
		RequestID:      requestID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEnrollmentSessionInvalid
		}
		return fmt.Errorf("consume telegram alert enrollment session: %w", err)
	}
	return nil
}

var ErrEnrollmentSessionInvalid = errors.New("telegram alert enrollment session is invalid or expired")

func (r *Repository) PurgeExpiredEnrollmentSessions(ctx context.Context) error {
	err := r.q.PurgeExpiredTelegramAlertEnrollmentSessions(ctx)
	if err != nil {
		return fmt.Errorf("purge telegram alert enrollment sessions: %w", err)
	}
	return nil
}

func subscriptionFromStore(row store.TelegramAlertSubscription) Subscription {
	return Subscription{
		ChatID:           row.ChatID,
		ChatType:         row.ChatType,
		SubscribedByUser: row.SubscribedByUserID,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
		DisabledAt:       row.DisabledAt,
	}
}
