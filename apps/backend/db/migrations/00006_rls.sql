-- +goose Up
-- 行级安全。每个请求在短事务内执行 SET LOCAL app.user_id，
-- 之后所有查询都被数据库强制限制在当前用户范围内，
-- 即使某条 SQL 忘记写 user_id 条件也不会跨用户泄漏。
--
-- 使用 FORCE ROW LEVEL SECURITY 是必要的：默认情况下表的所有者会绕过 RLS，
-- 而本地开发与迁移通常就用所有者角色连接。

-- +goose StatementBegin
DO $$
DECLARE
    t text;
    scoped_tables text[] := ARRAY[
        'user_preferences', 'user_ai_settings', 'auth_refresh_tokens',
        'projects', 'task_lists', 'tasks', 'events', 'notes', 'relations',
        'trackers', 'records',
        'captures', 'capture_parts', 'capture_candidates',
        'capture_relation_candidates', 'capture_questions', 'capture_conflicts',
        'async_operations', 'activity_batches', 'activity_entries',
        'idempotency_keys', 'processed_jobs', 'ai_actions'
    ];
BEGIN
    FOREACH t IN ARRAY scoped_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))',
            t || '_user_isolation', t);
    END LOOP;

    -- users 表用主键而不是 user_id 列做隔离。
    EXECUTE 'ALTER TABLE users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE users FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY users_user_isolation ON users '
            'USING (id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (id = current_setting(''app.user_id'', true))';
END
$$;
-- +goose StatementEnd

-- 登录链路在拿到用户身份之前就要读写这两张表，因此由专用的短路径访问：
-- auth_verification_codes 不含 user_id，不参与 RLS；
-- users 的按手机号查找与首次创建走 SECURITY DEFINER 函数，绕过 RLS 但只暴露最小能力。

-- +goose StatementBegin
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
CREATE FUNCTION auth_create_user(
    p_id text, p_phone text, p_display_name text, p_timezone text
)
RETURNS TABLE (
    id text, phone text, display_name text, avatar_url text,
    timezone text, initialized boolean,
    created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO users (id, phone, display_name, timezone)
    VALUES (p_id, p_phone, p_display_name, p_timezone)
    RETURNING users.id, users.phone, users.display_name, users.avatar_url,
              users.timezone, users.initialized, users.created_at, users.updated_at;
$$;
-- +goose StatementEnd

-- 用 Refresh Token 换新 Access Token 时同样还没有 app.user_id。
-- +goose StatementBegin
CREATE FUNCTION auth_find_refresh_token(p_token_hash bytea)
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

-- +goose Down
DROP FUNCTION IF EXISTS auth_find_refresh_token(bytea);
DROP FUNCTION IF EXISTS auth_create_user(text, text, text, text);
DROP FUNCTION IF EXISTS auth_find_user_by_phone(text);

-- +goose StatementBegin
DO $$
DECLARE
    t text;
    scoped_tables text[] := ARRAY[
        'user_preferences', 'user_ai_settings', 'auth_refresh_tokens',
        'projects', 'task_lists', 'tasks', 'events', 'notes', 'relations',
        'trackers', 'records',
        'captures', 'capture_parts', 'capture_candidates',
        'capture_relation_candidates', 'capture_questions', 'capture_conflicts',
        'async_operations', 'activity_batches', 'activity_entries',
        'idempotency_keys', 'processed_jobs', 'ai_actions', 'users'
    ];
BEGIN
    FOREACH t IN ARRAY scoped_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_user_isolation', t);
        EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END
$$;
-- +goose StatementEnd
