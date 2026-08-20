-- +goose Up
-- 后台管理的独立 schema。
--
-- 单开一个 schema 而不是塞进 public：后台的表和业务表的访问主体完全不同——
-- 业务表由 steward_app 在带用户身份的事务里读写，后台表由 steward_admin
-- 在没有用户身份的连接上读写。放在一起，权限就只能靠逐表 GRANT 维持，
-- 漏一张就是一个洞；分开之后可以按 schema 授权，新增表不会默认泄漏。
CREATE SCHEMA IF NOT EXISTS admin;

-- 管理员会话。
--
-- **只存散列不存令牌**：库被读走时攻击者也拿不到能用的 Cookie。
-- 这和用户侧的 refresh token 是同一条规矩。
CREATE TABLE admin.sessions (
    id                  text PRIMARY KEY,
    session_token_hash  bytea       NOT NULL UNIQUE,
    -- CSRF 密钥同样只存散列。它和 Session 一一对应，
    -- 于是「拿到一个 CSRF Token 就能配任意会话用」这条路不存在。
    csrf_secret_hash    bytea       NOT NULL,
    -- 凭证版本。改密码或轮换密钥时递增它，所有旧会话立刻失效——
    -- 不用逐条去删，也不会漏掉正在用的那些。
    credential_version  text        NOT NULL,
    -- 空闲超时：每次请求往后推。
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    -- 绝对超时：不随请求延长。只有空闲超时的话，
    -- 一个一直开着的标签页可以让会话永远活着。
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    user_agent          text        NOT NULL DEFAULT '',
    ip_hash             bytea
);

CREATE INDEX admin_sessions_expiry_idx ON admin.sessions (absolute_expires_at)
    WHERE revoked_at IS NULL;

-- 管理操作审计。
--
-- Admin 只有 INSERT 与 SELECT 权限，**没有 UPDATE 与 DELETE**：
-- 一份能被操作者自己改写的审计记录，等于没有审计。
CREATE TABLE admin.audit_logs (
    id             text        PRIMARY KEY,
    occurred_at    timestamptz NOT NULL,
    action         text        NOT NULL,
    outcome        text        NOT NULL,
    target_type    text,
    target_id      text,
    reason_code    text,
    reason_text    text,
    request_id     text        NOT NULL,
    -- 摘要只放状态、数量与 ID。**不放用户正文**：
    -- 审计比日志更持久、更容易被导出，反而最不该存正文。
    before_summary jsonb,
    after_summary  jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admin_audit_outcome_check CHECK (outcome IN ('succeeded', 'failed'))
);

CREATE INDEX admin_audit_time_idx ON admin.audit_logs (occurred_at DESC, id DESC);
CREATE INDEX admin_audit_target_idx ON admin.audit_logs (target_type, target_id, occurred_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin.audit_logs;
DROP TABLE IF EXISTS admin.sessions;
DROP SCHEMA IF EXISTS admin;
