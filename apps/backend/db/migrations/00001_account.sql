-- +goose Up
-- 账户、鉴权凭证、显式偏好与 AI 开关。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    id            text PRIMARY KEY,
    phone         text        NOT NULL,
    display_name  text        NOT NULL,
    avatar_url    text,
    timezone      text        NOT NULL DEFAULT 'Asia/Shanghai',
    initialized   boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);

CREATE UNIQUE INDEX users_phone_key ON users (phone) WHERE deleted_at IS NULL;

CREATE TABLE user_preferences (
    user_id                     text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    week_start                  text        NOT NULL DEFAULT 'monday',
    work_day_start              text        NOT NULL DEFAULT '09:00',
    work_day_end                text        NOT NULL DEFAULT '18:00',
    default_reminder_local_time text        NOT NULL DEFAULT '09:00',
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_preferences_week_start_check CHECK (week_start IN ('monday', 'sunday'))
);

CREATE TABLE user_ai_settings (
    user_id                 text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    capture_parse_enabled   boolean     NOT NULL DEFAULT true,
    suggestion_enabled      boolean     NOT NULL DEFAULT true,
    memory_learning_enabled boolean     NOT NULL DEFAULT true,
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 验证码只保存哈希，不保存明文，也不写入日志。
CREATE TABLE auth_verification_codes (
    id         text PRIMARY KEY,
    phone      text        NOT NULL,
    purpose    text        NOT NULL DEFAULT 'login',
    code_hash  bytea       NOT NULL,
    attempts   integer     NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verification_codes_phone_idx
    ON auth_verification_codes (phone, created_at DESC);

CREATE TABLE auth_refresh_tokens (
    id         text PRIMARY KEY,
    user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea       NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX auth_refresh_tokens_hash_key ON auth_refresh_tokens (token_hash);
CREATE INDEX auth_refresh_tokens_user_idx ON auth_refresh_tokens (user_id, expires_at DESC);

-- +goose Down
DROP TABLE auth_refresh_tokens;
DROP TABLE auth_verification_codes;
DROP TABLE user_ai_settings;
DROP TABLE user_preferences;
DROP TABLE users;
