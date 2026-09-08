#!/usr/bin/env bash
set -euo pipefail

# 仅用于 CI 的一次性 PostgreSQL 容器：先模拟漏授权，再执行真实向前迁移。
# 不接受线上连接串，避免对部署数据库执行测试建表。
if [[ "${CI:-}" != "true" || "${PGHOST:-}" != "127.0.0.1" ]]; then
  echo "该检查仅允许在 CI 的本机临时 PostgreSQL 上执行" >&2
  exit 1
fi
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE steward_p_admin NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE steward_prod;
SQL
psql -d steward_prod -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA admin;
CREATE TABLE admin.user_index(id text);
CREATE TABLE admin.user_daily_usage(id text);
CREATE TABLE admin.aggregation_runs(id text);
DO $$ BEGIN
  IF has_table_privilege('steward_p_admin','admin.user_index','SELECT') THEN
    RAISE EXCEPTION '前置条件错误：样本角色不应已有读取权限';
  END IF;
END $$;
SQL
sed '/-- +goose Down/,$d' apps/backend/db/migrations/00058_admin_read_model_acl.sql | psql -d steward_prod -v ON_ERROR_STOP=1
psql -d steward_prod -v ON_ERROR_STOP=1 <<'SQL'
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['admin.user_index','admin.user_daily_usage','admin.aggregation_runs'] LOOP
    IF NOT has_table_privilege('steward_p_admin',target,'SELECT')
       OR has_table_privilege('steward_p_admin',target,'UPDATE') THEN
      RAISE EXCEPTION '读模型权限不符合预期：%', target;
    END IF;
  END LOOP;
END $$;
SQL

# 管理员认证迁移同样必须验证生产角色命名分支，禁止运行账号自行授权。
psql -d steward_prod -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE admin.sessions(id text PRIMARY KEY, revoked_at timestamptz);
SQL
sed '/-- +goose Down/,$d' apps/backend/db/migrations/00059_admin_phone_auth.sql | psql -d steward_prod -v ON_ERROR_STOP=1
psql -d steward_prod -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT has_table_privilege('steward_p_admin','admin.accounts','SELECT')
    OR has_table_privilege('steward_p_admin','admin.accounts','INSERT')
    OR has_column_privilege('steward_p_admin','admin.accounts','enabled','UPDATE')
    OR NOT has_column_privilege('steward_p_admin','admin.accounts','password_hash','UPDATE') THEN
    RAISE EXCEPTION '生产后台管理员名单权限错误';
  END IF;
END $$;
SQL
