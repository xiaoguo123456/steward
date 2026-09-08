-- 后台读模型的聚合查询。
--
-- 由 Worker 以 steward_app 身份运行。跨用户的部分只碰 admin schema
-- 与不带 user_id 的表；每个用户自己的明细都在他的 RLS 事务里读。

-- 注：枚举用户那条走 SECURITY DEFINER 函数，sqlc 推不出 RETURNS TABLE 的
-- 列类型（会退化成 interface{}），因此在 modules/admin/aggregate 里用 pgx 手写，
-- 和登录前的那几个查询是同一处理。

-- name: UpsertUserIndex :exec
INSERT INTO admin.user_index (
    user_id, masked_phone, phone_lookup_hash, phone_hash_version, display_name,
    account_status, initialized, timezone, created_at, last_active_at,
    active_days_30d, ai_cost_30d_cny, ai_cost_status, latest_error_code,
    source_version, updated_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(masked_phone), sqlc.narg(phone_lookup_hash),
    sqlc.arg(phone_hash_version), sqlc.arg(display_name), sqlc.arg(account_status),
    sqlc.arg(initialized), sqlc.arg(timezone), sqlc.arg(created_at),
    sqlc.narg(last_active_at), sqlc.arg(active_days_30d),
    sqlc.narg(ai_cost_30d)::numeric, sqlc.arg(ai_cost_status),
    sqlc.narg(latest_error_code), sqlc.arg(source_version), now()
)
ON CONFLICT (user_id) DO UPDATE SET
    masked_phone = excluded.masked_phone,
    phone_lookup_hash = excluded.phone_lookup_hash,
    phone_hash_version = excluded.phone_hash_version,
    display_name = excluded.display_name,
    account_status = excluded.account_status,
    initialized = excluded.initialized,
    timezone = excluded.timezone,
    last_active_at = excluded.last_active_at,
    active_days_30d = excluded.active_days_30d,
    ai_cost_30d_cny = excluded.ai_cost_30d_cny,
    ai_cost_status = excluded.ai_cost_status,
    latest_error_code = excluded.latest_error_code,
    source_version = excluded.source_version,
    updated_at = now();

-- name: TouchUserIndex :exec
-- 只把「这个用户还在」这件事记下来，不动任何统计值。
--
-- 存在与统计必须分开：某个用户的统计算失败了，不代表他不存在了。
-- 只靠 upsert 的时间戳来判断存活，会把「这轮没算出来的人」当成
-- 「已经不存在的人」删掉——一次临时故障能删掉一批真实用户的索引。
UPDATE admin.user_index SET updated_at = now() WHERE user_id = sqlc.arg(user_id);

-- name: PruneUserIndex :execrows
-- 清掉这一轮没有被枚举到的用户。
--
-- **只在整轮枚举成功跑完之后调用。** 枚举中途失败时调它，
-- 没轮到的用户会被当成已删除清掉。
DELETE FROM admin.user_index WHERE updated_at < sqlc.arg(run_started_at);

-- name: PruneUserDailyUsage :execrows
-- 日表跟着索引走：索引里没有的用户，日报也留不住。
DELETE FROM admin.user_daily_usage
WHERE user_id NOT IN (SELECT user_id FROM admin.user_index);

-- name: UpsertUserDailyUsage :exec
-- 幂等：同一天重跑多少次结果都一样，因为是整行覆盖而不是累加。
INSERT INTO admin.user_daily_usage (
    user_id, report_date, active, capture_submitted, capture_confirmed,
    task_completed, assistant_turns, proposal_executed, review_generated,
    ai_input_tokens, ai_cached_input_tokens, ai_output_tokens,
    ai_cost_cny, ai_cost_status, updated_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(report_date)::date, sqlc.arg(active),
    sqlc.arg(capture_submitted), sqlc.arg(capture_confirmed), sqlc.arg(task_completed),
    sqlc.arg(assistant_turns), sqlc.arg(proposal_executed), sqlc.arg(review_generated),
    sqlc.arg(ai_input_tokens), sqlc.arg(ai_cached_input_tokens), sqlc.arg(ai_output_tokens),
    sqlc.narg(ai_cost)::numeric, sqlc.arg(ai_cost_status), now()
)
ON CONFLICT (user_id, report_date) DO UPDATE SET
    active = excluded.active,
    capture_submitted = excluded.capture_submitted,
    capture_confirmed = excluded.capture_confirmed,
    task_completed = excluded.task_completed,
    assistant_turns = excluded.assistant_turns,
    proposal_executed = excluded.proposal_executed,
    review_generated = excluded.review_generated,
    ai_input_tokens = excluded.ai_input_tokens,
    ai_cached_input_tokens = excluded.ai_cached_input_tokens,
    ai_output_tokens = excluded.ai_output_tokens,
    ai_cost_cny = excluded.ai_cost_cny,
    ai_cost_status = excluded.ai_cost_status,
    updated_at = now();

-- name: UserDailyFacts :one
-- 在某个用户的 RLS 事务里，统计他某一天的业务事实。
--
-- 口径按后台报表时区切日：把 UTC 时间戳转到该时区再取日期。
-- 不这么做的话，晚上八点之后的操作会被算到第二天。
SELECT
    (SELECT count(*) FROM captures
      WHERE (created_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS capture_submitted,
    (SELECT count(*) FROM captures
      WHERE status = 'confirmed'
        AND (updated_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS capture_confirmed,
    (SELECT count(*) FROM tasks
      WHERE status = 'done' AND completed_at IS NOT NULL
        AND (completed_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS task_completed,
    (SELECT count(*) FROM assistant_turns
      WHERE (created_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS assistant_turns,
    (SELECT count(*) FROM action_proposals
      WHERE status = 'confirmed'
        AND (updated_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS proposal_executed,
    (SELECT count(*) FROM review_snapshots
      WHERE generated_by = 'ai'
        AND (created_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date) AS review_generated;

-- name: UserDailyAICost :one
-- 某个用户某一天的 AI 用量与成本。
--
-- 成本只汇总 calculated 的部分；只要有一条缺价，状态就降级为 partial。
-- **不能因为大部分算出来了就报 calculated**，那会让一个偏低的数字看起来是准的。
SELECT
    coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
    coalesce(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens,
    coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
    -- **partial 的那部分也要算进来。** 一次调用里输入 token 算出来了、
    -- 输出 token 缺价，算出来的那部分钱是真实发生的，不该丢掉。
    (sum(estimated_cost_cny) FILTER (WHERE cost_status IN ('calculated', 'partial')))::numeric AS cost,
    CASE
        WHEN count(*) = 0 THEN 'no_usage'
        WHEN count(*) FILTER (WHERE cost_status IN ('pricing_missing', 'partial', 'pending')) = 0 THEN 'calculated'
        -- 判「一分钱都没算出来」要看有没有 calculated **或** partial：
        -- 全是 partial 时仍然有已知成本，报成 pricing_missing 会让界面
        -- 显示「价格缺失」并隐藏掉那笔真实花掉的钱。
        WHEN count(*) FILTER (WHERE cost_status IN ('calculated', 'partial')) = 0 THEN 'pricing_missing'
        ELSE 'partial'
    END::text AS cost_status
FROM ai_actions
WHERE (created_at AT TIME ZONE sqlc.arg(tz)::text)::date = sqlc.arg(day)::date;

-- 注：近 30 天的滚动统计在 modules/admin/aggregate 里用 pgx 手写。
-- sqlc 对 `max(...) FILTER (WHERE ...)` 的可空性推不出来：加 cast 会当成非空
-- （遇到 NULL 直接扫描失败），不加 cast 又退化成 interface{}。

-- name: StartAggregationRun :one
INSERT INTO admin.aggregation_runs (id, kind, report_date, status, started_at)
VALUES (sqlc.arg(id), sqlc.arg(kind), sqlc.narg(report_date)::date, 'running', now())
RETURNING *;

-- name: FinishAggregationRun :exec
UPDATE admin.aggregation_runs
   SET status = sqlc.arg(status), finished_at = now(),
       data_as_of = sqlc.narg(data_as_of), error_class = sqlc.narg(error_class),
       rows_written = sqlc.arg(rows_written)
 WHERE id = sqlc.arg(id);

-- name: LatestAggregation :one
-- 后台每个响应都要说出「这份数据算到什么时候」。
SELECT * FROM admin.aggregation_runs
WHERE kind = sqlc.arg(kind) AND status = 'succeeded'
ORDER BY finished_at DESC LIMIT 1;
