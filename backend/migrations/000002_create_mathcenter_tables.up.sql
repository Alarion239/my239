-- Create mathcenter schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS mathcenter;

-- Create centers table
CREATE TABLE IF NOT EXISTS mathcenter.centers (
    id BIGSERIAL PRIMARY KEY,
    graduation_year INTEGER NOT NULL
);

-- Create groups table
CREATE TABLE IF NOT EXISTS mathcenter.groups (
    id BIGSERIAL PRIMARY KEY,
    center_id BIGINT NOT NULL REFERENCES mathcenter.centers(id) ON DELETE CASCADE,
    group_name VARCHAR(255) NOT NULL
);

-- Create students table
CREATE TABLE IF NOT EXISTS mathcenter.students (
    id BIGSERIAL PRIMARY KEY,
    common_user_id BIGINT NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL REFERENCES mathcenter.groups(id) ON DELETE CASCADE
);

-- Create teachers table
CREATE TABLE IF NOT EXISTS mathcenter.teachers (
    id BIGSERIAL PRIMARY KEY,
    common_user_id BIGINT NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
    center_id BIGINT NOT NULL REFERENCES mathcenter.centers(id) ON DELETE CASCADE
);

