-- +goose Up
-- 聚合任务需要枚举用户，但 users 表受 RLS 约束：没有身份就一行都读不到。
--
-- 有两条路：给聚合任务 BYPASSRLS，或者开一个受控的 SECURITY DEFINER 函数。
-- 前者等于把「能读所有人的一切」这个能力发出去，一旦被别的代码路径用上
-- 就再也收不回来。这里选后者——**能力被限定成一个具体的函数签名**，
-- 它只返回聚合需要的那几个字段，返回不了别的。
--
-- 和登录路径上的 auth_find_user_by_phone 是同一类做法。

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
           -- account_status 由后续迁移加上；还没有时一律当 active。
           'active'::text
    FROM users u
    WHERE u.deleted_at IS NULL
      AND (p_after_id = '' OR u.id > p_after_id)
    ORDER BY u.id
    LIMIT greatest(p_limit, 1);
$$;
-- +goose StatementEnd

-- 只给聚合任务用的角色。**手机号在这里是明文**，因为要算查询用的 HMAC；
-- 算完只把脱敏结果与散列写进 admin.user_index，明文不落读模型。
GRANT EXECUTE ON FUNCTION admin_list_users_for_aggregation(int, text) TO steward_app;

-- +goose Down
DROP FUNCTION IF EXISTS admin_list_users_for_aggregation(int, text);
