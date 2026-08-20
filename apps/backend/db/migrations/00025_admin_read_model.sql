-- +goose Up
-- 后台的读模型。
--
-- 跨用户的列表与统计**不能实时扫业务表**：那些表全都受 RLS 约束，
-- 一个没有用户身份的连接一行都读不出来。硬要读就得给后台 BYPASSRLS，
-- 而那正是这套设计要避免的事。
--
-- 所以换个方向：由 Worker 以 steward_app 身份聚合出脱敏结果，
-- 写进 admin schema；后台只读这些聚合表。**代价是数据有延迟**，
-- 因此每个响应都必须带上「算到什么时候」，见 data_as_of。

-- 用户索引。后台用户列表读它，不读 users。
CREATE TABLE admin.user_index (
    user_id           text        PRIMARY KEY,
    -- 只存脱敏后的号码。后台任何界面都不显示完整手机号。
    masked_phone      text        NOT NULL,
    -- 精确查手机号用版本化 HMAC：既能查，又不留可直接读出的号码。
    -- 换密钥时递增 phone_hash_version，旧值失效而不是被误当成有效。
    phone_lookup_hash bytea,
    phone_hash_version integer    NOT NULL DEFAULT 1,
    display_name      text        NOT NULL DEFAULT '',
    account_status    text        NOT NULL DEFAULT 'active',
    initialized       boolean     NOT NULL DEFAULT false,
    timezone          text        NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL,
    last_active_at    timestamptz,
    active_days_30d   integer     NOT NULL DEFAULT 0,
    -- 成本可空。**没有价格时是 NULL 不是 0**，界面显示「价格缺失」。
    ai_cost_30d       numeric(20, 8),
    ai_cost_status    text        NOT NULL DEFAULT 'no_usage',
    latest_error_code text,
    source_version    integer     NOT NULL DEFAULT 0,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admin_user_index_status_check
        CHECK (account_status IN ('active', 'suspended')),
    CONSTRAINT admin_user_index_cost_status_check
        CHECK (ai_cost_status IN ('calculated', 'partial', 'pricing_missing', 'no_usage'))
);

-- 列表默认按注册时间倒序，游标分页要靠 (created_at, user_id) 这个全序。
-- 只按 created_at 排的话，同一毫秒注册的两个用户会在翻页时重复或漏掉。
CREATE INDEX admin_user_index_created_idx ON admin.user_index (created_at DESC, user_id DESC);
CREATE INDEX admin_user_index_phone_idx ON admin.user_index (phone_lookup_hash);
CREATE INDEX admin_user_index_active_idx ON admin.user_index (account_status, last_active_at DESC);

-- 用户日聚合。按后台报表时区切日。
CREATE TABLE admin.user_daily_usage (
    user_id                text        NOT NULL,
    report_date            date        NOT NULL,
    -- active 的口径是「当天产生过有效业务行为」。
    -- 刷新令牌、轮询、健康检查都不算——否则一个开着页面的客户端
    -- 会把自己刷成日活。
    active                 boolean     NOT NULL DEFAULT false,
    capture_submitted      integer     NOT NULL DEFAULT 0,
    capture_confirmed      integer     NOT NULL DEFAULT 0,
    task_completed         integer     NOT NULL DEFAULT 0,
    assistant_turns        integer     NOT NULL DEFAULT 0,
    proposal_executed      integer     NOT NULL DEFAULT 0,
    review_generated       integer     NOT NULL DEFAULT 0,
    ai_input_tokens        bigint      NOT NULL DEFAULT 0,
    ai_cached_input_tokens bigint      NOT NULL DEFAULT 0,
    ai_output_tokens       bigint      NOT NULL DEFAULT 0,
    ai_cost                numeric(20, 8),
    ai_cost_status         text        NOT NULL DEFAULT 'no_usage',
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, report_date),
    CONSTRAINT admin_daily_cost_status_check
        CHECK (ai_cost_status IN ('calculated', 'partial', 'pricing_missing', 'no_usage'))
);

CREATE INDEX admin_daily_date_idx ON admin.user_daily_usage (report_date, active);

-- 聚合运行状态。
--
-- 每个后台响应都要能说出「这份数据算到什么时候」。
-- 不标出来的话，一个还没聚合的今天会被读成「今天没人用」——
-- 那是最容易让人做出错误判断的一种错。
CREATE TABLE admin.aggregation_runs (
    id            text        PRIMARY KEY,
    kind          text        NOT NULL,
    report_date   date,
    status        text        NOT NULL,
    data_as_of    timestamptz,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    error_class   text,
    rows_written  integer     NOT NULL DEFAULT 0,
    CONSTRAINT admin_agg_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX admin_agg_kind_idx ON admin.aggregation_runs (kind, started_at DESC);

-- 聚合由 Worker 以 steward_app 身份写入，后台只读。
GRANT INSERT, UPDATE, DELETE, SELECT ON admin.user_index TO steward_app;
GRANT INSERT, UPDATE, DELETE, SELECT ON admin.user_daily_usage TO steward_app;
GRANT INSERT, UPDATE, SELECT ON admin.aggregation_runs TO steward_app;
GRANT USAGE ON SCHEMA admin TO steward_app;

-- +goose Down
REVOKE ALL ON admin.aggregation_runs FROM steward_app;
REVOKE ALL ON admin.user_daily_usage FROM steward_app;
REVOKE ALL ON admin.user_index FROM steward_app;
REVOKE USAGE ON SCHEMA admin FROM steward_app;
DROP TABLE IF EXISTS admin.aggregation_runs;
DROP TABLE IF EXISTS admin.user_daily_usage;
DROP TABLE IF EXISTS admin.user_index;
