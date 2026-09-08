-- +goose Up
-- 账本正式币种切换为人民币。原 USD 列保留，用于来源核对和旧镜像回滚兼容。
-- 仅既有美元历史按 2026-09-08 官方中间价 1 USD = 6.7804 CNY 折算；
-- 新人民币官方报价直接保存 CNY，不经过汇率折算。
-- 来源：https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do?COLLCC=546877760
ALTER TABLE public.ai_model_prices ADD COLUMN unit_price_cny numeric(20,8);
UPDATE public.ai_model_prices SET unit_price_cny=round(unit_price_usd*6.7804,8) WHERE unit_price_usd IS NOT NULL;
ALTER TABLE public.ai_action_cost_items ADD COLUMN unit_price_cny numeric(20,8);
UPDATE public.ai_action_cost_items SET unit_price_cny=round(unit_price_usd*6.7804,8) WHERE unit_price_usd IS NOT NULL;
ALTER TABLE public.ai_action_cost_items ADD COLUMN amount_cny numeric(20,8);
UPDATE public.ai_action_cost_items SET amount_cny=round(amount_usd*6.7804,8) WHERE amount_usd IS NOT NULL;
ALTER TABLE public.ai_actions ADD COLUMN estimated_cost_cny numeric(20,8);
UPDATE public.ai_actions SET estimated_cost_cny=round(estimated_cost*6.7804,8) WHERE estimated_cost IS NOT NULL;
ALTER TABLE admin.user_daily_usage ADD COLUMN ai_cost_cny numeric(20,8);
UPDATE admin.user_daily_usage SET ai_cost_cny=round(ai_cost*6.7804,8) WHERE ai_cost IS NOT NULL;
ALTER TABLE admin.user_index ADD COLUMN ai_cost_30d_cny numeric(20,8);
UPDATE admin.user_index SET ai_cost_30d_cny=round(ai_cost_30d*6.7804,8) WHERE ai_cost_30d IS NOT NULL;
ALTER TABLE ai_model_prices ALTER COLUMN unit_price_cny SET NOT NULL;
ALTER TABLE ai_model_prices ADD CONSTRAINT ai_model_prices_cny_positive CHECK (unit_price_cny >= 0);
-- 新旧镜像短暂并存或回滚时分别使用各自币种列，不能把人民币金额当成美元展示。
-- 触发器只同步金额，不读用户资料、不提升数据库权限；固定汇率仅用于旧列兼容。
-- +goose StatementBegin
CREATE FUNCTION public.sync_legacy_usd_cny() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 data jsonb := to_jsonb(NEW);
 previous jsonb;
 usd numeric;
 cny numeric;
 i integer := 0;
BEGIN
 IF TG_OP='UPDATE' THEN previous:=to_jsonb(OLD); END IF;
 WHILE i < TG_NARGS LOOP
  usd:=(data->>TG_ARGV[i])::numeric;
  cny:=(data->>TG_ARGV[i+1])::numeric;
  IF TG_OP='INSERT' THEN
   IF cny IS NOT NULL THEN usd:=round(cny/6.7804,8);
   ELSE cny:=round(usd*6.7804,8); END IF;
  ELSIF data->TG_ARGV[i+1] IS DISTINCT FROM previous->TG_ARGV[i+1] THEN
   usd:=round(cny/6.7804,8);
  ELSIF data->TG_ARGV[i] IS DISTINCT FROM previous->TG_ARGV[i] THEN
   cny:=round(usd*6.7804,8);
  END IF;
  data:=data || jsonb_build_object(TG_ARGV[i],usd,TG_ARGV[i+1],cny);
  i:=i+2;
 END LOOP;
 NEW:=jsonb_populate_record(NEW,data);
 RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER ai_model_prices_currency_sync BEFORE INSERT OR UPDATE ON public.ai_model_prices
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_usd_cny('unit_price_usd', 'unit_price_cny');
CREATE TRIGGER ai_action_cost_items_currency_sync BEFORE INSERT OR UPDATE ON public.ai_action_cost_items
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_usd_cny('unit_price_usd', 'unit_price_cny', 'amount_usd', 'amount_cny');
CREATE TRIGGER ai_actions_currency_sync BEFORE INSERT OR UPDATE ON public.ai_actions
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_usd_cny('estimated_cost', 'estimated_cost_cny');
CREATE TRIGGER user_daily_usage_currency_sync BEFORE INSERT OR UPDATE ON admin.user_daily_usage
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_usd_cny('ai_cost', 'ai_cost_cny');
CREATE TRIGGER user_index_currency_sync BEFORE INSERT OR UPDATE ON admin.user_index
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_usd_cny('ai_cost_30d', 'ai_cost_30d_cny');

-- +goose Down
DROP TRIGGER ai_model_prices_currency_sync ON public.ai_model_prices;
DROP TRIGGER ai_action_cost_items_currency_sync ON public.ai_action_cost_items;
DROP TRIGGER ai_actions_currency_sync ON public.ai_actions;
DROP TRIGGER user_daily_usage_currency_sync ON admin.user_daily_usage;
DROP TRIGGER user_index_currency_sync ON admin.user_index;
DROP FUNCTION public.sync_legacy_usd_cny();
ALTER TABLE admin.user_index DROP COLUMN ai_cost_30d_cny;
ALTER TABLE admin.user_daily_usage DROP COLUMN ai_cost_cny;
ALTER TABLE public.ai_actions DROP COLUMN estimated_cost_cny;
ALTER TABLE public.ai_action_cost_items DROP COLUMN amount_cny;
ALTER TABLE public.ai_action_cost_items DROP COLUMN unit_price_cny;
ALTER TABLE public.ai_model_prices DROP COLUMN unit_price_cny;
