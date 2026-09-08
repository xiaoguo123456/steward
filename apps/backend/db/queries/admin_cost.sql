-- AI 成本核算与后台读模型的查询。
--
-- **金额一律在 SQL 里用 numeric 算**，Go 只负责搬字符串。
-- 用 float64 搬一趟就会有舍入误差，而这是钱。

-- name: UpsertAIPrice :one
INSERT INTO ai_model_prices (
    id, provider, model, usage_unit, unit_size, unit_price_cny,
    effective_from, effective_until
) VALUES (
    sqlc.arg(id), sqlc.arg(provider), sqlc.arg(model), sqlc.arg(usage_unit),
    sqlc.arg(unit_size)::numeric, sqlc.arg(unit_price_cny)::numeric,
    sqlc.arg(effective_from), sqlc.narg(effective_until)
)
RETURNING *;

-- name: ListAIPrices :many
SELECT id, provider, model, usage_unit,
       unit_size::text AS unit_size, unit_price_cny::text AS unit_price_cny,
       effective_from, effective_until, created_at
FROM ai_model_prices
ORDER BY provider, model, usage_unit, effective_from DESC;

-- name: RetireAIPrice :exec
-- 停用一个价格版本：给它一个结束时间，而不是删掉。
-- 删掉会让引用它的历史成本明细失去来源，账就对不上了。
UPDATE ai_model_prices SET effective_until = sqlc.arg(effective_until)
 WHERE id = sqlc.arg(id) AND effective_until IS NULL;

-- name: ListPendingCostActions :many
-- 取还没算成本的调用。
SELECT id, user_id, provider, provider_model, feature,
       input_tokens, cached_input_tokens, output_tokens, created_at
FROM ai_actions
WHERE cost_status = 'pending'
ORDER BY created_at
LIMIT sqlc.arg(row_limit);

-- name: DeleteCostItems :exec
-- 重算之前先清掉旧明细。**重算必须幂等**：同一次调用重算多少遍，
-- 结果都应当一样，而不是把成本累加两遍。
DELETE FROM ai_action_cost_items WHERE ai_action_id = sqlc.arg(ai_action_id);

-- name: InsertCostItem :exec
-- 写一条成本明细，价格按调用发生的时刻匹配。
--
-- 匹配不到价格时 amount_cny 为 NULL、状态 pricing_missing——
-- **不写 0**。「不知道多少钱」和「不花钱」是完全不同的两件事。
INSERT INTO ai_action_cost_items (
    id, ai_action_id, price_id, usage_unit, quantity,
    unit_size, unit_price_cny, amount_cny, cost_status
)
SELECT
    sqlc.arg(id), sqlc.arg(ai_action_id), p.id, sqlc.arg(usage_unit)::text,
    sqlc.arg(quantity)::numeric, p.unit_size, p.unit_price_cny,
    CASE WHEN p.id IS NULL OR sqlc.arg(quantity)::numeric = 0 THEN NULL
         ELSE sqlc.arg(quantity)::numeric / p.unit_size * p.unit_price_cny END,
    CASE WHEN sqlc.arg(quantity)::numeric = 0 THEN 'not_applicable'
         WHEN p.id IS NULL THEN 'pricing_missing'
         ELSE 'calculated' END
FROM (SELECT 1) AS anchor
LEFT JOIN ai_model_prices p
       ON p.provider = sqlc.arg(provider)::text
      AND p.model = sqlc.arg(model)::text
      AND p.usage_unit = sqlc.arg(usage_unit)::text
      AND p.effective_from <= sqlc.arg(occurred_at)::timestamptz
      AND (p.effective_until IS NULL OR p.effective_until > sqlc.arg(occurred_at)::timestamptz)
ON CONFLICT (ai_action_id, usage_unit) DO UPDATE SET
    price_id = excluded.price_id, quantity = excluded.quantity,
    unit_size = excluded.unit_size, unit_price_cny = excluded.unit_price_cny,
    amount_cny = excluded.amount_cny, cost_status = excluded.cost_status;

-- name: RollupActionCost :exec
-- 把明细汇总回 ai_actions 上的缓存列。
--
-- 状态取最保守的那个：只要有一项缺价，整次调用就是 partial（有明细算出来了）
-- 或 pricing_missing（一项都没算出来）。**不能因为大部分算出来了就报 calculated**，
-- 那会让一个偏低的数字看起来是准的。
UPDATE ai_actions a SET
    estimated_cost_cny = s.total,
    cost_status = s.status,
    cost_calculated_at = now()
FROM (
    SELECT
        SUM(amount_cny) FILTER (WHERE cost_status = 'calculated') AS total,
        CASE
            WHEN count(*) FILTER (WHERE cost_status <> 'not_applicable') = 0 THEN 'not_applicable'
            WHEN count(*) FILTER (WHERE cost_status = 'pricing_missing') = 0 THEN 'calculated'
            WHEN count(*) FILTER (WHERE cost_status = 'calculated') = 0 THEN 'pricing_missing'
            ELSE 'partial'
        END AS status
    FROM ai_action_cost_items WHERE ai_action_id = sqlc.arg(ai_action_id)
) s
WHERE a.id = sqlc.arg(ai_action_id);

-- name: ResetCostStatus :exec
-- 新增或停用价格之后，把受影响的调用重新标成待算。
-- 只影响这个 Provider + 模型，不是全表重算。
UPDATE ai_actions SET cost_status = 'pending', estimated_cost_cny = NULL, cost_calculated_at = NULL
 WHERE provider = sqlc.arg(provider) AND provider_model = sqlc.arg(model);
