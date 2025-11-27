-- Create common schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS common;

-- Create users table
CREATE TABLE IF NOT EXISTS common.users (
    id BIGSERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    middle_name VARCHAR(255),
    last_name VARCHAR(255)
);
