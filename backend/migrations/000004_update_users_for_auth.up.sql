ALTER TABLE common.users
ADD COLUMN username VARCHAR(100) UNIQUE NOT NULL,
ADD COLUMN password_hash VARCHAR(255) NOT NULL,
ADD COLUMN invitation_token_id BIGINT NOT NULL REFERENCES authorization.invitation_tokens(id),
ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_users_invitation_token_id ON common.users (invitation_token_id);
CREATE INDEX idx_users_username ON common.users (username);
