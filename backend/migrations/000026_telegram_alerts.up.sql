CREATE TABLE telegram_alert_subscriptions (
    chat_id BIGINT PRIMARY KEY,
    chat_type TEXT NOT NULL CHECK (chat_type IN ('private', 'group', 'supergroup')),
    subscribed_by_user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ
);

CREATE TABLE telegram_alert_enrollment_sessions (
    telegram_user_id BIGINT PRIMARY KEY,
    request_id BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telegram_alert_enrollment_sessions_expiry
    ON telegram_alert_enrollment_sessions (expires_at);
