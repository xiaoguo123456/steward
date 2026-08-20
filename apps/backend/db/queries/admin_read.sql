-- 后台只读查询。
--
-- 跨用户的部分**全部读 admin schema 的脱敏读模型**，一行业务表都不碰：
-- 业务表受 RLS 约束，没有身份读不出来；有身份又只能看一个人。
-- 读模型正是为这个矛盾存在的。

-- name: AdminListUsers :many
-- 用户列表。游标是 (created_at, user_id) 的复合序——
-- 只按 created_at 排的话，同一毫秒注册的两个用户翻页时会重复或漏掉。
SELECT user_id, masked_phone, display_name, account_status, initialized,
       created_at, last_active_at, active_days_30d,
       (coalesce(ai_cost_30d::text, ''))::text AS ai_cost_30d, ai_cost_status, latest_error_code
FROM admin.user_index
WHERE (sqlc.narg(account_status)::text IS NULL OR account_status = sqlc.narg(account_status)::text)
  AND (sqlc.narg(initialized)::boolean IS NULL OR initialized = sqlc.narg(initialized)::boolean)
  AND (sqlc.narg(user_id)::text IS NULL OR user_id = sqlc.narg(user_id)::text)
  AND (sqlc.narg(phone_hash)::bytea IS NULL OR phone_lookup_hash = sqlc.narg(phone_hash)::bytea)
  AND (sqlc.narg(cursor_created)::timestamptz IS NULL
       OR (created_at, user_id) < (sqlc.narg(cursor_created)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, user_id DESC
LIMIT sqlc.arg(row_limit);

-- name: AdminGetUserIndex :one
SELECT user_id, masked_phone, display_name, account_status, initialized, timezone,
       created_at, last_active_at, active_days_30d,
       (coalesce(ai_cost_30d::text, ''))::text AS ai_cost_30d, ai_cost_status, latest_error_code
FROM admin.user_index WHERE user_id = sqlc.arg(user_id);

-- name: AdminUserDailyUsage :many
SELECT report_date, active, capture_submitted, capture_confirmed, task_completed,
       assistant_turns, proposal_executed, review_generated,
       ai_input_tokens, ai_cached_input_tokens, ai_output_tokens,
       (coalesce(ai_cost::text, ''))::text AS ai_cost, ai_cost_status
FROM admin.user_daily_usage
WHERE user_id = sqlc.arg(user_id)
  AND report_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY report_date;

-- name: AdminDashboardUsers :one
-- 用户口径。DAU/WAU/MAU 都从日聚合里数去重用户，
-- **不从登录或轮询算**——那会把一个开着页面的客户端算成活跃。
SELECT
    (SELECT count(*) FROM admin.user_index)::bigint AS total,
    (SELECT count(*) FROM admin.user_index
      WHERE (created_at AT TIME ZONE sqlc.arg(tz)::text)::date
            BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date)::bigint AS new_users,
    (SELECT count(*) FROM admin.user_index WHERE initialized)::bigint AS initialized,
    (SELECT count(DISTINCT user_id) FROM admin.user_daily_usage
      WHERE active AND report_date = sqlc.arg(to_date)::date)::bigint AS dau,
    (SELECT count(DISTINCT user_id) FROM admin.user_daily_usage
      WHERE active AND report_date > sqlc.arg(to_date)::date - 7)::bigint AS wau,
    (SELECT count(DISTINCT user_id) FROM admin.user_daily_usage
      WHERE active AND report_date > sqlc.arg(to_date)::date - 30)::bigint AS mau;

-- name: AdminDashboardUsage :one
SELECT
    coalesce(sum(capture_submitted), 0)::bigint AS capture_submitted,
    coalesce(sum(capture_confirmed), 0)::bigint AS capture_confirmed,
    coalesce(sum(assistant_turns), 0)::bigint AS assistant_turns,
    coalesce(sum(task_completed), 0)::bigint AS task_completed
FROM admin.user_daily_usage
WHERE report_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date;

-- name: AdminDashboardAI :one
-- AI 口径。
--
-- 成本只汇总算得出来的部分，另外单列「有多少次调用缺价」——
-- 这个数不为 0 时，上面那个金额一定是偏低的，界面必须让人看见这一点。
SELECT
    coalesce(sum(ai_input_tokens), 0)::bigint AS input_tokens,
    coalesce(sum(ai_cached_input_tokens), 0)::bigint AS cached_input_tokens,
    coalesce(sum(ai_output_tokens), 0)::bigint AS output_tokens,
    (coalesce((sum(ai_cost) FILTER (WHERE ai_cost_status IN ('calculated', 'partial')))::text, ''))::text AS cost,
    count(*) FILTER (WHERE ai_cost_status IN ('pricing_missing', 'partial'))::bigint AS pricing_missing_days,
    CASE
        WHEN count(*) FILTER (WHERE ai_cost_status <> 'no_usage') = 0 THEN 'no_usage'
        WHEN count(*) FILTER (WHERE ai_cost_status IN ('pricing_missing', 'partial')) = 0 THEN 'calculated'
        WHEN count(*) FILTER (WHERE ai_cost_status IN ('calculated', 'partial')) = 0 THEN 'pricing_missing'
        ELSE 'partial'
    END::text AS cost_status
FROM admin.user_daily_usage
WHERE report_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date;

-- name: AdminDashboardTrends :many
SELECT report_date,
       count(DISTINCT user_id) FILTER (WHERE active)::bigint AS active_users,
       coalesce(sum(capture_submitted), 0)::bigint AS capture_submitted,
       coalesce(sum(assistant_turns), 0)::bigint AS assistant_turns,
       (coalesce((sum(ai_cost) FILTER (WHERE ai_cost_status IN ('calculated', 'partial')))::text, ''))::text AS ai_cost,
       CASE
           WHEN count(*) FILTER (WHERE ai_cost_status <> 'no_usage') = 0 THEN 'no_usage'
           WHEN count(*) FILTER (WHERE ai_cost_status IN ('pricing_missing', 'partial')) = 0 THEN 'calculated'
           WHEN count(*) FILTER (WHERE ai_cost_status IN ('calculated', 'partial')) = 0 THEN 'pricing_missing'
           ELSE 'partial'
       END::text AS cost_status
FROM admin.user_daily_usage
WHERE report_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
GROUP BY report_date ORDER BY report_date;

-- 注：队列状态查 river_job，那张表由 River 在运行时自建、不在迁移里，
-- sqlc 不认识它。因此在 modules/admin/ops 里用 pgx 手写。

-- name: AdminListAuditLogs :many
SELECT id, occurred_at, actor_username, action, outcome, target_type, target_id,
       reason_code, reason_text, request_id
FROM admin.audit_logs
WHERE (sqlc.narg(action)::text IS NULL OR action = sqlc.narg(action)::text)
  AND (sqlc.narg(target_id)::text IS NULL OR target_id = sqlc.narg(target_id)::text)
  AND (sqlc.narg(cursor_time)::timestamptz IS NULL
       OR (occurred_at, id) < (sqlc.narg(cursor_time)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: AdminLatestAggregation :one
SELECT data_as_of, status, finished_at FROM admin.aggregation_runs
WHERE kind = sqlc.arg(kind) ORDER BY started_at DESC LIMIT 1;
