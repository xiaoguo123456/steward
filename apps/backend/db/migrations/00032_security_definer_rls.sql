-- +goose Up
-- 阿里云 RDS 的环境迁移账号不是超级用户，也没有 BYPASSRLS。
-- users 与 auth_refresh_tokens 若启用 FORCE RLS，同账号拥有的 SECURITY DEFINER
-- 函数仍会被策略拦截，导致首次登录无法创建用户、刷新登录态也无法查找令牌。
--
-- 保留 FORCE RLS，只允许表属主在 SECURITY DEFINER 已把 current_user 切换为函数
-- 属主、且 session_user 仍是调用方时执行最小的 SELECT / INSERT。表属主直接连接时
-- current_user = session_user，不会命中这些策略。

-- +goose StatementBegin
DO $$
DECLARE
    users_owner name;
    refresh_owner name;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO users_owner
    FROM pg_class WHERE oid = 'users'::regclass;
    SELECT pg_get_userbyid(relowner) INTO refresh_owner
    FROM pg_class WHERE oid = 'auth_refresh_tokens'::regclass;

    EXECUTE format(
        'CREATE POLICY users_auth_definer_select ON users '
        'AS PERMISSIVE FOR SELECT TO %I USING (current_user <> session_user)',
        users_owner
    );
    EXECUTE format(
        'CREATE POLICY users_auth_definer_insert ON users '
        'AS PERMISSIVE FOR INSERT TO %I WITH CHECK (current_user <> session_user)',
        users_owner
    );
    EXECUTE format(
        'CREATE POLICY refresh_tokens_auth_definer_select ON auth_refresh_tokens '
        'AS PERMISSIVE FOR SELECT TO %I USING (current_user <> session_user)',
        refresh_owner
    );
END
$$;
-- +goose StatementEnd

-- PostgreSQL 默认把新函数的 EXECUTE 授给 PUBLIC。SECURITY DEFINER 必须显式收口，
-- 只保留既有迁移已授予的应用角色。
REVOKE EXECUTE ON FUNCTION auth_find_user_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_create_user(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_refresh_token(bytea) FROM PUBLIC;

-- +goose Down
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO PUBLIC;

DROP POLICY IF EXISTS refresh_tokens_auth_definer_select ON auth_refresh_tokens;
DROP POLICY IF EXISTS users_auth_definer_insert ON users;
DROP POLICY IF EXISTS users_auth_definer_select ON users;
