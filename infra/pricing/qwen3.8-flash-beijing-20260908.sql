-- 阿里云北京地域按量调用原价，核验日：2026-09-08。
-- 来源：https://help.aliyun.com/zh/model-studio/qwen3-8-flash
-- 每百万 Token：普通输入 CNY 0.8、缓存输入 CNY 0.1、输出 CNY 2.7。
-- 正式账本以人民币计价，直接保存官方原价，不进行汇率换算。
-- 仅用于已核实 openai 适配器连接阿里云北京地域的环境，不修改模型选择。
-- 从核验日零点生效，不追溯更早未知价格。价格冲突时整笔回滚，不覆盖旧版本。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('pricing:qwen3.8-flash:beijing:20260908'));
INSERT INTO ai_model_prices
 (id, provider, model, usage_unit, unit_size, unit_price_cny, effective_from)
SELECT 'aip_qwen38_bj_20260908_' || usage_unit, 'openai', 'qwen3.8-flash', usage_unit,
       1000000, cny_price, '2026-09-08T00:00:00+08:00'::timestamptz
FROM (VALUES ('input_token', 0.8::numeric), ('cached_input_token', 0.1::numeric),
             ('output_token', 2.7::numeric)) AS prices(usage_unit, cny_price)
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
 IF (SELECT count(*) FROM ai_model_prices p JOIN
      (VALUES ('input_token', 0.8::numeric), ('cached_input_token', 0.1::numeric),
              ('output_token', 2.7::numeric)) AS expected(unit, cny_price)
      ON p.id = 'aip_qwen38_bj_20260908_' || expected.unit
      WHERE p.provider='openai' AND p.model='qwen3.8-flash' AND p.usage_unit=expected.unit
       AND p.unit_size=1000000 AND p.unit_price_cny=expected.cny_price
       AND p.effective_from='2026-09-08T00:00:00+08:00'::timestamptz
       AND p.effective_until IS NULL) <> 3 THEN
  RAISE EXCEPTION '已有价格版本与核验清单不一致，停止录入';
 END IF;
END $$;
COMMIT;
SELECT model, usage_unit, unit_size::text, unit_price_cny::text, effective_from
FROM ai_model_prices WHERE id LIKE 'aip_qwen38_bj_20260908_%' ORDER BY usage_unit;
