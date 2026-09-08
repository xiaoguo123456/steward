-- 后台管理的查询。
--
-- 这些表在 admin schema 里，由 steward_admin 角色访问。
-- 业务表的查询仍然在各自的文件里，不混进来。

-- name: CreateAdminSession :one
INSERT INTO admin.sessions (
    id, session_token_hash, csrf_secret_hash, credential_version,
    last_seen_at, expires_at, absolute_expires_at, user_agent, ip_hash, admin_id, account_credential_version
) VALUES (
    sqlc.arg(id), sqlc.arg(session_token_hash), sqlc.arg(csrf_secret_hash),
    sqlc.arg(credential_version), now(), sqlc.arg(expires_at),
    sqlc.arg(absolute_expires_at), sqlc.arg(user_agent), sqlc.narg(ip_hash), sqlc.narg(admin_id), sqlc.arg(account_credential_version)
)
RETURNING *;

-- name: FindAdminSession :one
-- 按令牌散列取会话。过期与撤销的判断放在 Go 里做，
-- 因为要区分「空闲超时」「绝对超时」「已撤销」「凭证版本变了」四种情况，
-- 各自给出的提示不一样。
SELECT * FROM admin.sessions WHERE session_token_hash = sqlc.arg(session_token_hash);

-- name: TouchAdminSession :exec
-- 每次请求把空闲超时往后推。绝对超时不动。
UPDATE admin.sessions
   SET last_seen_at = now(), expires_at = sqlc.arg(expires_at)
 WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: RevokeAdminSession :exec
UPDATE admin.sessions SET revoked_at = now()
 WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: PurgeExpiredAdminSessions :exec
-- 清理已经绝对过期的会话。留着也没用，还让表越来越大。
DELETE FROM admin.sessions WHERE absolute_expires_at < now() - interval '7 days';

-- name: RecordAdminAudit :one
-- 写一条管理操作审计。
--
-- 摘要只放状态、数量与 ID。**不放用户正文。**
INSERT INTO admin.audit_logs (
    id, occurred_at, actor_username, actor_session_id,
    action, outcome, target_type, target_id,
    reason_code, reason_text, request_id, before_summary, after_summary
) VALUES (
    sqlc.arg(id), sqlc.arg(occurred_at),
    sqlc.arg(actor_username), sqlc.narg(actor_session_id),
    sqlc.arg(action), sqlc.arg(outcome),
    sqlc.narg(target_type), sqlc.narg(target_id), sqlc.narg(reason_code),
    sqlc.narg(reason_text), sqlc.arg(request_id),
    sqlc.narg(before_summary), sqlc.narg(after_summary)
)
RETURNING *;

-- name: ListAdminAudit :many
SELECT * FROM admin.audit_logs
WHERE (sqlc.narg(action)::text IS NULL OR action = sqlc.narg(action)::text)
  AND (sqlc.narg(target_id)::text IS NULL OR target_id = sqlc.narg(target_id)::text)
  AND (sqlc.narg(before)::timestamptz IS NULL OR occurred_at < sqlc.narg(before)::timestamptz)
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: FindAdminSessionByID :one
SELECT * FROM admin.sessions WHERE id = sqlc.arg(id);
