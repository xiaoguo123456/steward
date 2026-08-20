-- +goose Up
-- AI 成本核算。
--
-- 之前 ai_actions.estimated_cost 是 NOT NULL DEFAULT 0，于是「不知道多少钱」
-- 和「不花钱」在库里长得一模一样。**这两件事完全不同**：前者是我们还没配
-- 价格，后者是这次调用确实免费。都记成 0 的话，任何成本报表都会系统性偏低，
-- 而且从数字上看不出偏低。
--
-- 这次改成可空 + 明确的状态列。

-- 价格表。同一 Provider + 模型 + 用量单位的生效区间不允许重叠。
--
-- **改价是新增一个版本，不是覆盖旧值。** 覆盖会让历史账目跟着变——
-- 上个月按旧价算出来的成本，这个月一看变了，那份报表就没有任何意义了。
CREATE TABLE ai_model_prices (
    id              text        PRIMARY KEY,
    provider        text        NOT NULL,
    model           text        NOT NULL,
    usage_unit      text        NOT NULL,
    -- unit_size 是单价对应的用量。比如「每 1000 个输入 token 0.002 美元」
    -- 就是 unit_size=1000、unit_price_usd=0.002。
    -- 不写死成「每 1k」：音频按秒、图片按张，单位大小各不相同。
    unit_size       numeric(20, 6) NOT NULL,
    unit_price_usd  numeric(20, 8) NOT NULL,
    effective_from  timestamptz NOT NULL,
    effective_until timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_model_prices_unit_check CHECK (usage_unit IN (
        'input_token', 'cached_input_token', 'output_token',
        'audio_second', 'image', 'request'
    )),
    CONSTRAINT ai_model_prices_size_check CHECK (unit_size > 0),
    CONSTRAINT ai_model_prices_price_check CHECK (unit_price_usd >= 0),
    CONSTRAINT ai_model_prices_range_check
        CHECK (effective_until IS NULL OR effective_until > effective_from)
);

-- 生效区间不重叠，由排他约束保证而不是靠应用层自觉。
-- 重叠了就会出现「同一次调用能匹配到两个价格」，那时算出来的数字取决于
-- 查询的排序，等于不确定。
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE ai_model_prices ADD CONSTRAINT ai_model_prices_no_overlap
    EXCLUDE USING gist (
        provider WITH =,
        model WITH =,
        usage_unit WITH =,
        tstzrange(effective_from, effective_until) WITH &&
    );

CREATE INDEX ai_model_prices_lookup_idx
    ON ai_model_prices (provider, model, usage_unit, effective_from DESC);

-- 单次调用的成本明细。一次调用可能有多个用量单位（输入 token、输出 token、
-- 缓存输入……），各自匹配各自的价格。
--
-- 拆成明细而不是只存一个总额：总额算错了没法回溯是哪一项错了，
-- 也没法在补上某个价格之后只重算那一项。
CREATE TABLE ai_action_cost_items (
    id             text        PRIMARY KEY,
    ai_action_id   text        NOT NULL REFERENCES ai_actions (id) ON DELETE CASCADE,
    price_id       text        REFERENCES ai_model_prices (id),
    usage_unit     text        NOT NULL,
    quantity       numeric(20, 6) NOT NULL,
    unit_size      numeric(20, 6),
    unit_price_usd numeric(20, 8),
    -- amount_usd 为空表示「有用量但没有价格」，不是 0。
    amount_usd     numeric(20, 8),
    cost_status    text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_cost_items_status_check CHECK (cost_status IN (
        'calculated', 'pricing_missing', 'pending', 'not_applicable'
    )),
    -- 算出来了就必须有金额与价格来源；没算出来就不许有金额。
    -- 这条防的是「状态说算好了，金额却是空的」这种自相矛盾的行。
    CONSTRAINT ai_cost_items_amount_check CHECK (
        (cost_status = 'calculated' AND amount_usd IS NOT NULL AND price_id IS NOT NULL)
        OR (cost_status <> 'calculated' AND amount_usd IS NULL)
    )
);

CREATE INDEX ai_cost_items_action_idx ON ai_action_cost_items (ai_action_id);
CREATE UNIQUE INDEX ai_cost_items_unique_idx ON ai_action_cost_items (ai_action_id, usage_unit);

-- ai_actions 上的成本缓存。
ALTER TABLE ai_actions ADD COLUMN cached_input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE ai_actions ADD COLUMN cost_status text NOT NULL DEFAULT 'pending';
ALTER TABLE ai_actions ADD COLUMN cost_calculated_at timestamptz;
ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_cost_status_check CHECK (cost_status IN (
    'calculated', 'partial', 'pricing_missing', 'pending', 'not_applicable'
));

-- estimated_cost：NOT NULL DEFAULT 0 → 可空。
--
-- **已有的 0 不能当成真实成本。** 它们是「从来没算过」，不是「花了 0 元」。
-- 全部清成 NULL，状态置 pending，由回填任务重新算。
ALTER TABLE ai_actions ALTER COLUMN estimated_cost DROP NOT NULL;
ALTER TABLE ai_actions ALTER COLUMN estimated_cost DROP DEFAULT;
ALTER TABLE ai_actions ALTER COLUMN estimated_cost TYPE numeric(20, 8);
UPDATE ai_actions SET estimated_cost = NULL, cost_status = 'pending';

CREATE INDEX ai_actions_cost_pending_idx ON ai_actions (created_at)
    WHERE cost_status = 'pending';
CREATE INDEX ai_actions_report_idx ON ai_actions (created_at, provider, feature);

-- +goose Down
DROP INDEX IF EXISTS ai_actions_report_idx;
DROP INDEX IF EXISTS ai_actions_cost_pending_idx;
UPDATE ai_actions SET estimated_cost = 0 WHERE estimated_cost IS NULL;
ALTER TABLE ai_actions ALTER COLUMN estimated_cost TYPE numeric(12, 6);
ALTER TABLE ai_actions ALTER COLUMN estimated_cost SET DEFAULT 0;
ALTER TABLE ai_actions ALTER COLUMN estimated_cost SET NOT NULL;
ALTER TABLE ai_actions DROP CONSTRAINT IF EXISTS ai_actions_cost_status_check;
ALTER TABLE ai_actions DROP COLUMN IF EXISTS cost_calculated_at;
ALTER TABLE ai_actions DROP COLUMN IF EXISTS cost_status;
ALTER TABLE ai_actions DROP COLUMN IF EXISTS cached_input_tokens;
DROP TABLE IF EXISTS ai_action_cost_items;
DROP TABLE IF EXISTS ai_model_prices;
