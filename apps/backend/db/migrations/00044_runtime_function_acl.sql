-- +goose Up
-- 00042 重建了登录函数并新增账号删除函数。DROP/CREATE 会清空已有 ACL，
-- 因此必须在同一条向前迁移中补齐正式环境运行账号，不能只授权本地 steward_app。

REVOKE EXECUTE ON FUNCTION auth_find_user_by_phone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_create_user(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_refresh_token(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_account_is_active(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_list_users_for_aggregation(int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_deletion_worker_media_keys(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_deletion_worker_purge_primary(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, text) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO steward_app;
GRANT EXECUTE ON FUNCTION auth_account_is_active(text) TO steward_app;
GRANT EXECUTE ON FUNCTION admin_list_users_for_aggregation(int, text) TO steward_app;
GRANT EXECUTE ON FUNCTION account_deletion_worker_media_keys(text) TO steward_app;
GRANT EXECUTE ON FUNCTION account_deletion_worker_purge_primary(text) TO steward_app;

-- +goose StatementBegin
DO $$
DECLARE
    app_role text;
BEGIN
    CASE current_database()
        WHEN 'steward_test' THEN app_role := 'steward_t_app';
        WHEN 'steward_prod' THEN app_role := 'steward_p_app';
        ELSE RETURN;
    END CASE;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        -- 本地开发也可能把数据库命名为 steward_test；只有部署数据库强制要求环境角色。
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('pg_rds_superuser', 'rds_superuser')) THEN
            RAISE EXCEPTION '缺少环境应用账号 %', app_role;
        END IF;
        RETURN;
    END IF;

    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_find_user_by_phone(text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text, text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_find_refresh_token(bytea) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION auth_account_is_active(text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION admin_list_users_for_aggregation(int, text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION account_deletion_worker_media_keys(text) TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION account_deletion_worker_purge_primary(text) TO %I', app_role);
END
$$;
-- +goose StatementEnd

-- +goose Down
-- 运行账号 ACL 与 PUBLIC 收口属于安全边界，不提供自动降级。
SELECT 1;
