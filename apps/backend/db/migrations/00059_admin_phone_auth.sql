-- +goose Up
CREATE TABLE admin.accounts (
    id text PRIMARY KEY,
    phone text NOT NULL UNIQUE CHECK (phone ~ '^1[3-9][0-9]{9}$'),
    enabled boolean NOT NULL DEFAULT true,
    password_hash text,
    credential_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    password_changed_at timestamptz
);

-- 旧会话没有可追溯管理员身份，切换认证体系时统一撤销。
ALTER TABLE admin.sessions ADD COLUMN admin_id text REFERENCES admin.accounts(id);
ALTER TABLE admin.sessions ADD COLUMN account_credential_version bigint NOT NULL DEFAULT 0;
UPDATE admin.sessions SET revoked_at = now() WHERE revoked_at IS NULL;
CREATE INDEX admin_sessions_account_idx ON admin.sessions(admin_id);

CREATE TABLE admin.phone_challenges (
    id text PRIMARY KEY,
    admin_id text NOT NULL REFERENCES admin.accounts(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('login', 'password_reset')),
    code_hash bytea NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    sent_at timestamptz,
    consumed_at timestamptz
);
CREATE INDEX admin_phone_challenges_account_idx ON admin.phone_challenges(admin_id, created_at DESC);

-- 默认授权可能含全表写权限，必须先撤销，再按列授予认证流程需要的权限。
-- 管理员名单只允许迁移／运维账号维护，后台进程不能增加或提升管理员。
-- +goose StatementBegin
DO $$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['steward_admin', CASE current_database()
      WHEN 'steward_test' THEN 'steward_t_admin'
      WHEN 'steward_prod' THEN 'steward_p_admin' ELSE 'steward_admin' END]
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON admin.accounts, admin.phone_challenges FROM %I', role_name);
        EXECUTE format('GRANT SELECT ON admin.accounts TO %I', role_name);
        EXECUTE format('GRANT UPDATE (password_hash, credential_version, password_changed_at) ON admin.accounts TO %I', role_name);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON admin.phone_challenges TO %I', role_name);
      END IF;
    END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE admin.sessions DROP COLUMN account_credential_version;
ALTER TABLE admin.sessions DROP COLUMN admin_id;
DROP TABLE admin.phone_challenges;
DROP TABLE admin.accounts;
