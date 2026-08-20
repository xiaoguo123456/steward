-- +goose Up
-- 后台写操作需要的表权限。
--
-- **逐张授予，不整库放开。** 后台该能做的事是有限的几件：暂停/恢复用户、
-- 撤销会话、设预算、配价格。权限就该正好覆盖这几件，多一张表都是多一个洞。
--
-- 注意这里给的仍然只是「能不能执行这条语句」。**能不能看到别人的行由 RLS 决定**，
-- 而 steward_admin 是 NOBYPASSRLS 的——它必须在某个用户的身份下开事务，
-- 一次只能碰一个人的数据。

-- 幂等键：写操作要靠它判断重放。
GRANT SELECT, INSERT ON idempotency_keys TO steward_admin;

-- 管理动作记录：只增不改。这是「这个用户身上现在生效着什么」的流水，
-- 改写它等于篡改处置历史。
GRANT SELECT, INSERT ON user_account_actions TO steward_admin;

-- AI 预算：可增删改，因为它本来就是一个可调的配置。
GRANT SELECT, INSERT, UPDATE, DELETE ON user_ai_budgets TO steward_admin;

-- 价格表不带 user_id，不受 RLS 约束。
-- 允许新增与停用版本，**不允许删除**：删掉会让引用它的历史成本失去来源。
GRANT SELECT, INSERT, UPDATE ON ai_model_prices TO steward_admin;

-- 改价之后要把受影响的调用标回待算，因此需要 UPDATE。
-- 但仍然只能改自己身份下能看到的那些行。
GRANT SELECT, UPDATE ON ai_actions TO steward_admin;
GRANT SELECT ON ai_action_cost_items TO steward_admin;

-- +goose Down
REVOKE ALL ON ai_action_cost_items FROM steward_admin;
REVOKE ALL ON ai_actions FROM steward_admin;
REVOKE ALL ON ai_model_prices FROM steward_admin;
REVOKE ALL ON user_ai_budgets FROM steward_admin;
REVOKE ALL ON user_account_actions FROM steward_admin;
REVOKE ALL ON idempotency_keys FROM steward_admin;
