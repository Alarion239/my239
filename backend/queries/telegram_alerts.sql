-- Persistent Telegram alert destinations and one-use group enrollment state.

-- name: ListActiveTelegramAlertSubscriptions :many
SELECT chat_id, chat_type, subscribed_by_user_id, created_at, updated_at, disabled_at
FROM telegram_alert_subscriptions
WHERE disabled_at IS NULL
ORDER BY chat_id;

-- name: GetTelegramAlertSubscription :one
SELECT chat_id, chat_type, subscribed_by_user_id, created_at, updated_at, disabled_at
FROM telegram_alert_subscriptions
WHERE chat_id = $1;

-- name: UpsertTelegramAlertSubscription :exec
INSERT INTO telegram_alert_subscriptions
    (chat_id, chat_type, subscribed_by_user_id)
VALUES ($1, $2, $3)
ON CONFLICT (chat_id) DO UPDATE SET
    chat_type = EXCLUDED.chat_type,
    subscribed_by_user_id = EXCLUDED.subscribed_by_user_id,
    updated_at = NOW(),
    disabled_at = NULL;

-- name: DeleteTelegramAlertSubscription :exec
DELETE FROM telegram_alert_subscriptions WHERE chat_id = $1;

-- name: DisableTelegramAlertSubscription :exec
UPDATE telegram_alert_subscriptions
SET disabled_at = COALESCE(disabled_at, NOW()), updated_at = NOW()
WHERE chat_id = $1;

-- name: CreateTelegramAlertEnrollmentSession :exec
INSERT INTO telegram_alert_enrollment_sessions
    (telegram_user_id, request_id, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (telegram_user_id) DO UPDATE SET
    request_id = EXCLUDED.request_id,
    expires_at = EXCLUDED.expires_at,
    created_at = NOW();

-- name: ConsumeTelegramAlertEnrollmentSession :one
DELETE FROM telegram_alert_enrollment_sessions
WHERE telegram_user_id = $1
  AND request_id = $2
  AND expires_at > NOW()
RETURNING telegram_user_id;

-- name: PurgeExpiredTelegramAlertEnrollmentSessions :exec
DELETE FROM telegram_alert_enrollment_sessions WHERE expires_at <= NOW();
