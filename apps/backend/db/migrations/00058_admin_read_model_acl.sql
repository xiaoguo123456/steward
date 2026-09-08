-- +goose Up
-- 环境专属后台账号的默认权限不追溯已有表，补齐运营读模型的最小只读授权。
-- +goose StatementBegin
DO $$
DECLARE
    admin_role text := 'steward_admin';
BEGIN
    CASE current_database()
        WHEN 'steward_test' THEN admin_role := 'steward_t_admin';
        WHEN 'steward_prod' THEN admin_role := 'steward_p_admin';
        ELSE NULL;
    END CASE;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = admin_role) THEN
        RAISE EXCEPTION '缺少后台账号 %', admin_role;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA admin TO %I', admin_role);
    EXECUTE format('GRANT SELECT ON admin.user_index, admin.user_daily_usage, admin.aggregation_runs TO %I', admin_role);
END
$$;
-- +goose StatementEnd

-- +goose Down
-- 仅撤销原来遗漏的环境专属账号授权；本地 steward_admin 原本已拥有这些只读权限。
-- +goose StatementBegin
DO $$
DECLARE admin_role text;
BEGIN
    CASE current_database()
        WHEN 'steward_test' THEN admin_role := 'steward_t_admin';
        WHEN 'steward_prod' THEN admin_role := 'steward_p_admin';
        ELSE RETURN;
    END CASE;
    EXECUTE format('REVOKE SELECT ON admin.user_index, admin.user_daily_usage, admin.aggregation_runs FROM %I', admin_role);
END
$$;
-- +goose StatementEnd
