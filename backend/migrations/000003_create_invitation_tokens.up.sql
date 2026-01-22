-- Create authorization schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS authorize;

-- Create invitation tokens table
CREATE TABLE IF NOT EXISTS authorize.invitation_tokens (
    id BIGSERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    max_uses INT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
