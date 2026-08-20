-- +goose Up
-- 用户账号状态与管理动作记录。

-- 账号状态。
--
-- status_version 是乐观锁：管理操作必须带上它，两个人同时改的时候
-- 后一个会拿到版本冲突，而不是**悄悄覆盖掉前一个的决定**——
-- 暂停与恢复互相覆盖是很实际的风险，两个运营看着同一个用户各点各的。
ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN status_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN suspension_expires_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended'));

-- 状态与时间戳必须自洽：不能出现「状态是 active 却有暂停时间」这种行。
-- 靠代码保证不够——直接写 SQL 的人绕得过去，约束绕不过去。
ALTER TABLE users ADD CONSTRAINT users_suspension_consistency_check
    CHECK ((account_status = 'suspended' AND suspended_at IS NOT NULL)
        OR (account_status = 'active' AND suspended_at IS NULL));

CREATE INDEX users_account_status_idx ON users (account_status)
    WHERE account_status <> 'active';

-- 管理动作记录。
--
-- 它和 admin.audit_logs 的区别：审计记的是「谁在什么时候做了什么」，
-- 这张表记的是「这个用户身上现在生效着什么」。前者是流水，后者是状态。
-- 分开是因为查询方向完全不同——看某个用户的处置历史，
-- 不该去翻整个后台的操作流水。
CREATE TABLE user_account_actions (
    id              text        PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    action          text        NOT NULL,
    reason_code     text        NOT NULL,
    reason_text     text        NOT NULL,
    effective_from  timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    -- 指回审计流水。**业务变更与审计在同一个事务里提交**，
    -- 因此这个 ID 一定存在——不存在就说明有人绕过了管理接口。
    audit_log_id    text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_account_actions_action_check CHECK (action IN (
        'suspend', 'resume', 'sessions_revoke', 'budget_update'
    ))
);

CREATE INDEX user_account_actions_user_idx ON user_account_actions (user_id, created_at DESC);

-- 用户的 AI 预算。
--
-- 预算是「每天/每月最多允许多少次 AI 调用」，不是钱：钱由用量乘单价算出来，
-- 而单价会变；用次数封顶，用户和运营都算得清。
CREATE TABLE user_ai_budgets (
    user_id         text        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    daily_calls     integer,
    monthly_calls   integer,
    effective_from  timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_ai_budgets_positive_check CHECK (
        (daily_calls IS NULL OR daily_calls >= 0)
        AND (monthly_calls IS NULL OR monthly_calls >= 0)
    )
);

-- 这两张表都带 user_id，必须按同一套规矩上 RLS——
-- TestAllUserTablesForceRLS 会扫出来，漏了直接报错。
ALTER TABLE user_account_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY user_account_actions_isolation ON user_account_actions
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE user_ai_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ai_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY user_ai_budgets_isolation ON user_ai_budgets
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_account_actions TO steward_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_ai_budgets TO steward_app;
GRANT SELECT, INSERT ON user_account_actions TO steward_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_ai_budgets TO steward_admin;

-- 枚举函数要跟着返回真实状态，否则读模型里所有人永远是 active。
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION admin_list_users_for_aggregation(
    p_limit int,
    p_after_id text
)
RETURNS TABLE (
    id             text,
    phone          text,
    display_name   text,
    timezone       text,
    initialized    boolean,
    created_at     timestamptz,
    account_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.phone, u.display_name, u.timezone, u.initialized, u.created_at,
           u.account_status
    FROM users u
    WHERE u.deleted_at IS NULL
      AND (p_after_id = '' OR u.id > p_after_id)
    ORDER BY u.id
    LIMIT greatest(p_limit, 1);
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS user_ai_budgets;
DROP TABLE IF EXISTS user_account_actions;
DROP INDEX IF EXISTS users_account_status_idx;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_suspension_consistency_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users DROP COLUMN IF EXISTS suspension_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS suspended_at;
ALTER TABLE users DROP COLUMN IF EXISTS status_version;
ALTER TABLE users DROP COLUMN IF EXISTS account_status;
