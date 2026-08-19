-- +goose Up
-- 应用角色。API 与 Worker 必须以非超级用户身份连接，否则 RLS 会被整体绕过：
-- FORCE ROW LEVEL SECURITY 只能约束表的所有者，超级用户和带 BYPASSRLS 的角色仍然无视策略。
-- 迁移入口继续使用具备 DDL 权限的角色，两者职责分离。

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'steward_app') THEN
        -- 本地开发口令；生产环境必须改用独立保管的凭证或 IAM 认证。
        CREATE ROLE steward_app LOGIN PASSWORD 'steward_dev_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO steward_app', current_database());
END
$$;
-- +goose StatementEnd

GRANT USAGE ON SCHEMA public TO steward_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO steward_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO steward_app;

-- 登录链路在拿到用户身份之前需要这三个 SECURITY DEFINER 函数。
GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO steward_app;

-- 验证码表不含 user_id，不参与 RLS，但仍只授予必要权限。
GRANT SELECT, INSERT, UPDATE ON auth_verification_codes TO steward_app;

-- 后续迁移新建的表自动继承同样的权限，避免每次迁移都要补 GRANT。
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO steward_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO steward_app;

-- +goose Down
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM steward_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE USAGE, SELECT ON SEQUENCES FROM steward_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM steward_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM steward_app;
REVOKE USAGE ON SCHEMA public FROM steward_app;
-- 角色是集群级对象，可能被其他数据库共用，因此不在回滚中删除。
