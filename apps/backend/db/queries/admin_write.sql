-- 后台的写操作。
--
-- 每一个都在**单个事务**里完成「读当前状态 → 校验版本 → 改 → 写审计」。
-- 审计写不进去，业务变更也回滚——一条能被绕过的审计，
-- 比没有审计更危险：它会让人以为所有操作都有记录。

-- name: AdminLockUserForUpdate :one
-- 取用户当前状态并加行锁。
--
-- **必须 FOR UPDATE。** 两个运营同时点「暂停」，不加锁的话两条都会成功、
-- 版本各加一次，而实际只该有一次状态转换。
SELECT id, account_status, status_version, suspended_at, suspension_expires_at
FROM users WHERE id = sqlc.arg(id) AND deleted_at IS NULL
FOR UPDATE;

-- name: AdminSetUserStatus :one
-- 改账号状态并推进版本号。
--
-- WHERE 里再带一次 status_version：即使调用方忘了先加锁，
-- 版本对不上时这条 UPDATE 也不会命中任何行。
UPDATE users
   SET account_status = sqlc.arg(account_status),
       suspended_at = sqlc.narg(suspended_at),
       suspension_expires_at = sqlc.narg(suspension_expires_at),
       status_version = status_version + 1,
       updated_at = now()
 WHERE id = sqlc.arg(id) AND status_version = sqlc.arg(expected_version)
RETURNING id, account_status, status_version, suspended_at, suspension_expires_at;

-- name: AdminRevokeUserSessions :execrows
-- 撤销该用户全部有效会话，返回撤销了几条。
UPDATE auth_refresh_tokens SET revoked_at = now()
 WHERE revoked_at IS NULL AND expires_at > now();

-- name: AdminRecordAccountAction :one
INSERT INTO user_account_actions (
    id, user_id, action, reason_code, reason_text,
    effective_from, effective_until, audit_log_id
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(action),
    sqlc.arg(reason_code), sqlc.arg(reason_text),
    now(), sqlc.narg(effective_until), sqlc.arg(audit_log_id)
)
RETURNING *;

-- name: AdminUpsertBudget :one
INSERT INTO user_ai_budgets (
    user_id, daily_calls, monthly_calls, effective_from, effective_until, updated_at
) VALUES (
    sqlc.arg(user_id), sqlc.narg(daily_calls), sqlc.narg(monthly_calls),
    coalesce(sqlc.narg(effective_from)::timestamptz, now()),
    sqlc.narg(effective_until), now()
)
ON CONFLICT (user_id) DO UPDATE SET
    daily_calls = excluded.daily_calls,
    monthly_calls = excluded.monthly_calls,
    effective_from = excluded.effective_from,
    effective_until = excluded.effective_until,
    updated_at = now()
RETURNING *;

-- name: AdminGetBudget :one
SELECT * FROM user_ai_budgets WHERE user_id = sqlc.arg(user_id);

-- name: AdminClearBudget :exec
DELETE FROM user_ai_budgets WHERE user_id = sqlc.arg(user_id);

-- name: AdminFindIdempotency :one
-- 幂等键。
--
-- 同一个键配同样的请求返回同样的结果；**配不同的请求返回冲突**——
-- 那说明调用方把键复用错了，不该当成重放而把上一次的结果发回去。
-- request_hash 就是用来分辨这两种情况的。
SELECT user_id, endpoint, key, request_hash, status_code, response_body, resource_id
FROM idempotency_keys
WHERE user_id = sqlc.arg(user_id) AND endpoint = sqlc.arg(endpoint) AND key = sqlc.arg(key);

-- name: AdminSaveIdempotency :exec
INSERT INTO idempotency_keys (
    user_id, endpoint, key, request_hash, status_code, response_body, resource_id, expires_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(endpoint), sqlc.arg(key), sqlc.arg(request_hash),
    sqlc.arg(status_code), sqlc.arg(response_body), sqlc.narg(resource_id),
    now() + interval '24 hours'
)
ON CONFLICT (user_id, endpoint, key) DO NOTHING;
