-- +goose Up
-- 正式账号删除：单用途重新认证、受理记录与不含身份信息的状态镜像。

ALTER TABLE users DROP CONSTRAINT users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended', 'deletion_pending'));
ALTER TABLE users DROP CONSTRAINT users_suspension_consistency_check;
ALTER TABLE users ADD CONSTRAINT users_suspension_consistency_check
    CHECK ((account_status = 'suspended' AND suspended_at IS NOT NULL)
        OR (account_status IN ('active', 'deletion_pending') AND suspended_at IS NULL));

CREATE TABLE account_deletion_reauth_tokens (
    id          text        PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    idempotency_key text    NOT NULL,
    request_hash bytea      NOT NULL,
    token_hash  bytea       NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
    ,CONSTRAINT account_deletion_reauth_idempotency_unique
        UNIQUE (user_id, idempotency_key)
);

CREATE INDEX account_deletion_reauth_user_idx
    ON account_deletion_reauth_tokens (user_id, created_at DESC);

CREATE TABLE account_deletion_requests (
    id               text        PRIMARY KEY,
    user_id          text        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    idempotency_key  text        NOT NULL,
    request_hash     bytea       NOT NULL,
    status           text        NOT NULL,
    accepted_at      timestamptz NOT NULL,
    backup_expires_at timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_deletion_requests_status_check CHECK (status IN (
        'accepted', 'revoking_sessions', 'purging_assets',
        'purging_derivatives', 'purging_primary', 'completed', 'failed'
    )),
    CONSTRAINT account_deletion_requests_idempotency_unique
        UNIQUE (user_id, idempotency_key)
);

-- 状态镜像故意不带 user_id、手机号、对象键或任何业务资源引用。
-- replay_user_hash 是用途隔离 HMAC，无法还原账号；用户记录物理删除后，
-- 独立状态凭证和同键受理重放仍能查询首次结果。
CREATE TABLE account_deletion_status_records (
    request_id        text        PRIMARY KEY,
    replay_user_hash  bytea       NOT NULL,
    idempotency_key_hash bytea    NOT NULL,
    request_hash      bytea       NOT NULL,
    status_token_hash bytea       NOT NULL UNIQUE,
    status            text        NOT NULL,
    accepted_at       timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    backup_expires_at timestamptz NOT NULL,
    public_error      text,
    CONSTRAINT account_deletion_status_records_status_check CHECK (status IN (
        'accepted', 'revoking_sessions', 'purging_assets',
        'purging_derivatives', 'purging_primary', 'completed', 'failed'
    )),
    CONSTRAINT account_deletion_status_replay_unique
        UNIQUE (replay_user_hash, idempotency_key_hash)
);

ALTER TABLE account_deletion_reauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_reauth_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY account_deletion_reauth_tokens_user_isolation
    ON account_deletion_reauth_tokens
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY account_deletion_requests_user_isolation
    ON account_deletion_requests
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON account_deletion_reauth_tokens TO steward_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_deletion_requests TO steward_app;
GRANT SELECT, INSERT, UPDATE ON account_deletion_status_records TO steward_app;

-- 登录查找需要看见非 active 账号，才能明确拒绝而不是误走“首次注册”。
DROP FUNCTION auth_find_user_by_phone(text);
-- +goose StatementBegin
CREATE FUNCTION auth_find_user_by_phone(p_phone text)
RETURNS TABLE (
    id text, phone text, display_name text, avatar_url text,
    timezone text, initialized boolean,
    created_at timestamptz, updated_at timestamptz,
    account_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.phone, u.display_name, u.avatar_url,
           u.timezone, u.initialized, u.created_at, u.updated_at,
           u.account_status
    FROM users u
    WHERE u.phone = p_phone AND u.deleted_at IS NULL;
$$;
-- +goose StatementEnd

-- Refresh Token 只有在账号仍为 active 时才能换取新会话。
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_token_hash bytea)
RETURNS TABLE (id text, user_id text, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.user_id, t.expires_at, t.revoked_at
    FROM auth_refresh_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = p_token_hash
      AND u.deleted_at IS NULL
      AND u.account_status = 'active';
$$;
-- +goose StatementEnd

-- Access Token 是无状态 JWT；每次受保护请求用这个最小函数确认账号仍可用。
-- +goose StatementBegin
CREATE FUNCTION auth_account_is_active(p_user_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_user_id AND deleted_at IS NULL AND account_status = 'active'
    );
$$;
-- +goose StatementEnd

-- Worker 只拿 request_id；用户 ID 和对象键在固定函数内短暂解析，不写入任务参数。
-- +goose StatementBegin
CREATE FUNCTION account_deletion_worker_media_keys(p_request_id text)
RETURNS TABLE (object_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.object_key
    FROM account_deletion_requests r
    JOIN media_assets m ON m.user_id = r.user_id
    WHERE r.id = p_request_id;
$$;
-- +goose StatementEnd

-- 物理清理在线主库与后台读模型，并移除其他仍携带用户引用的队列任务。
-- 当前删除任务参数只有 request_id，不会被这条条件误删。
-- +goose StatementBegin
CREATE FUNCTION account_deletion_worker_purge_primary(p_request_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
    target_user_id text;
BEGIN
    SELECT user_id INTO target_user_id
    FROM public.account_deletion_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF target_user_id IS NULL THEN
        RETURN false;
    END IF;

    IF to_regclass('public.river_job') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.river_job WHERE args ->> ''user_id'' = $1'
        USING target_user_id;
    END IF;

    DELETE FROM admin.user_daily_usage WHERE user_id = target_user_id;
    DELETE FROM admin.user_index WHERE user_id = target_user_id;
    DELETE FROM public.users WHERE id = target_user_id;
    RETURN true;
END;
$$;
-- +goose StatementEnd

-- PostgreSQL 默认给新函数 PUBLIC EXECUTE；所有 SECURITY DEFINER 必须先显式收口。
REVOKE EXECUTE ON FUNCTION auth_account_is_active(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_user_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_refresh_token(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_deletion_worker_media_keys(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_deletion_worker_purge_primary(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_account_is_active(text) TO steward_app;
REVOKE EXECUTE ON FUNCTION auth_find_user_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_refresh_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO steward_app;
GRANT EXECUTE ON FUNCTION account_deletion_worker_media_keys(text) TO steward_app;
GRANT EXECUTE ON FUNCTION account_deletion_worker_purge_primary(text) TO steward_app;

-- +goose Down
DROP FUNCTION IF EXISTS account_deletion_worker_purge_primary(text);
DROP FUNCTION IF EXISTS account_deletion_worker_media_keys(text);
DROP FUNCTION IF EXISTS auth_account_is_active(text);
DROP TABLE IF EXISTS account_deletion_status_records;
DROP TABLE IF EXISTS account_deletion_requests;
DROP TABLE IF EXISTS account_deletion_reauth_tokens;

ALTER TABLE users DROP CONSTRAINT users_suspension_consistency_check;
ALTER TABLE users ADD CONSTRAINT users_suspension_consistency_check
    CHECK ((account_status = 'suspended' AND suspended_at IS NOT NULL)
        OR (account_status = 'active' AND suspended_at IS NULL));
ALTER TABLE users DROP CONSTRAINT users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended'));

-- +goose StatementBegin
DROP FUNCTION auth_find_user_by_phone(text);
CREATE FUNCTION auth_find_user_by_phone(p_phone text)
RETURNS TABLE (
    id text, phone text, display_name text, avatar_url text,
    timezone text, initialized boolean,
    created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.phone, u.display_name, u.avatar_url,
           u.timezone, u.initialized, u.created_at, u.updated_at
    FROM users u
    WHERE u.phone = p_phone AND u.deleted_at IS NULL;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_token_hash bytea)
RETURNS TABLE (id text, user_id text, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.user_id, t.expires_at, t.revoked_at
    FROM auth_refresh_tokens t
    WHERE t.token_hash = p_token_hash;
$$;
-- +goose StatementEnd

GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO steward_app;
