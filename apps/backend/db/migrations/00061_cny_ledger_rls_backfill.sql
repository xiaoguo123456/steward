-- +goose Up
-- 线上迁移账号没有 BYPASSRLS；00060 的全表 UPDATE 不能访问受隔离的调用。
-- 通过既有的有限用户枚举函数逐个设置身份，只补缺少的 CNY 值，不重复转换。
-- +goose StatementBegin
DO $$
DECLARE
 actor record;
BEGIN
 FOR actor IN SELECT id FROM public.admin_list_users_for_aggregation(2147483647, '') LOOP
  PERFORM set_config('app.user_id', actor.id, true);
  UPDATE ai_actions
     SET estimated_cost_cny=round(estimated_cost*6.7804,8)
   WHERE user_id=actor.id AND estimated_cost IS NOT NULL AND estimated_cost_cny IS NULL;
 END LOOP;
 PERFORM set_config('app.user_id', '', true);
END $$;
-- +goose StatementEnd

-- +goose Down
-- 数据补全不撤销；00060 的兼容 USD 列始终保留，回滚代码无需清除人民币金额。
SELECT 1;
