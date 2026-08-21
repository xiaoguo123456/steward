-- +goose Up
-- 测试与生产共用一个 RDS 实例时，数据库角色是集群级对象，不能复用同一个登录账号。
-- 本迁移只在两个部署库生效，把既有 ACL 复制给各自的运行账号，并隔离数据库 CONNECT。

-- +goose StatementBegin
DO $$
DECLARE
    app_role text;
    admin_role text;
BEGIN
    -- 本地测试也常用 steward_test 这个库名；只有阿里云 RDS 才启用部署账号约束。
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_superuser') THEN
        RETURN;
    END IF;

    CASE current_database()
        WHEN 'steward_test' THEN
            app_role := 'steward_t_app';
            admin_role := 'steward_t_admin';
        WHEN 'steward_prod' THEN
            app_role := 'steward_p_app';
            admin_role := 'steward_p_admin';
        ELSE
            RETURN;
    END CASE;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        RAISE EXCEPTION '缺少环境应用账号 %', app_role;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = admin_role) THEN
        RAISE EXCEPTION '缺少环境后台账号 %', admin_role;
    END IF;

    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC, steward_app, steward_admin', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I, %I', current_database(), app_role, admin_role);
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;

    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION admin_list_users_for_aggregation(int, text) TO %I', app_role);
    EXECUTE format('GRANT USAGE ON SCHEMA admin TO %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON admin.user_index, admin.user_daily_usage TO %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON admin.aggregation_runs TO %I', app_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);

    EXECUTE format('GRANT USAGE ON SCHEMA public, admin TO %I', admin_role);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', admin_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON admin.sessions TO %I', admin_role);
    EXECUTE format('GRANT SELECT, INSERT ON admin.audit_logs TO %I', admin_role);
    EXECUTE format('GRANT INSERT, UPDATE ON users TO %I', admin_role);
    EXECUTE format('GRANT UPDATE ON auth_refresh_tokens TO %I', admin_role);
    EXECUTE format('GRANT SELECT, INSERT ON idempotency_keys, user_account_actions TO %I', admin_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON user_ai_budgets TO %I', admin_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_model_prices TO %I', admin_role);
    EXECUTE format('GRANT SELECT, UPDATE ON ai_actions TO %I', admin_role);
    EXECUTE format('GRANT SELECT ON ai_action_cost_items TO %I', admin_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO %I', admin_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT ON TABLES TO %I', admin_role);
END
$$;
-- +goose StatementEnd

-- +goose Down
-- 账号隔离是安全边界，部署库不提供自动降级。
SELECT 1;
