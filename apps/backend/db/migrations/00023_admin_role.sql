-- +goose Up
-- 后台的数据库角色。
--
-- **它和 steward_app 一样是 NOBYPASSRLS 的。** 这是整个后台设计里最要紧的
-- 一条：后台能看跨用户的统计，靠的是读 admin schema 里的脱敏聚合表，
-- 而不是靠一个能无视行级安全的连接。要看某个用户的明细时，走
-- WithAdminUserTx 在那个用户的身份下开事务——和普通 API 走的是同一套策略。
--
-- 如果这里给了 BYPASSRLS，后台就变成一把万能钥匙：一个 SQL 注入、
-- 一次误写的 WHERE，就能横跨所有人的数据。RLS 是这个系统唯一的强保证，
-- 不该为了「后台方便」在它上面开洞。

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'steward_admin') THEN
        -- 本地开发口令；生产环境必须改用独立保管的凭证或 IAM 认证。
        CREATE ROLE steward_admin LOGIN PASSWORD 'steward_admin_dev_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO steward_admin', current_database());
END
$$;
-- +goose StatementEnd

-- admin schema：会话与审计。
GRANT USAGE ON SCHEMA admin TO steward_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.sessions TO steward_admin;

-- 审计表**只给 INSERT 与 SELECT**。
-- 一份能被操作者自己改写或删除的审计，等于没有审计。
GRANT SELECT, INSERT ON admin.audit_logs TO steward_admin;

-- 后续在 admin schema 里新建的读模型表，默认只读。
-- 聚合任务由 Worker 以 steward_app 身份写入，后台只负责看。
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT ON TABLES TO steward_admin;

-- public schema：能读，也能在用户身份下执行必要的写。
--
-- 读写权限本身不等于能看到别人的数据——RLS 才是那道闸。
-- 没有身份的事务里，带 user_id 的表一行都读不出来。
GRANT USAGE ON SCHEMA public TO steward_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO steward_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO steward_admin;

-- 用户管理要改这几张表，逐张授予而不是整库放开：
-- 后台该能做的事是有限的几件，权限也就该是有限的几张表。
GRANT INSERT, UPDATE ON users TO steward_admin;
GRANT UPDATE ON auth_refresh_tokens TO steward_admin;

-- +goose Down
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM steward_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM steward_admin;
REVOKE USAGE ON SCHEMA admin FROM steward_admin;
REVOKE USAGE ON SCHEMA public FROM steward_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin REVOKE SELECT ON TABLES FROM steward_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM steward_admin;
