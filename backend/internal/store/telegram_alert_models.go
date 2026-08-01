package store

import "time"

// TelegramAlertEnrollmentSession is the short-lived, one-use group-picker
// authorization state for a Telegram user.
type TelegramAlertEnrollmentSession struct {
	TelegramUserID int64     `json:"telegram_user_id"`
	RequestID      int64     `json:"request_id"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

// TelegramAlertSubscription is a persisted Telegram destination. Display
// names, usernames, passwords, and bot credentials are intentionally absent.
type TelegramAlertSubscription struct {
	ChatID             int64      `json:"chat_id"`
	ChatType           string     `json:"chat_type"`
	SubscribedByUserID int64      `json:"subscribed_by_user_id"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	DisabledAt         *time.Time `json:"disabled_at"`
}
