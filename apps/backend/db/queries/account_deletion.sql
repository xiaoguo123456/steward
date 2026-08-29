-- 账号删除事务内查询；Worker 跨用户路径只调用迁移中的固定 SECURITY DEFINER 函数。

-- name: CreateAccountDeletionReauthToken :one
INSERT INTO account_deletion_reauth_tokens (
    id, user_id, idempotency_key, request_hash, token_hash, expires_at
)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(idempotency_key),
    sqlc.arg(request_hash), sqlc.arg(token_hash), sqlc.arg(expires_at)
)
RETURNING *;

-- name: GetAccountDeletionReauthTokenByIdempotency :one
SELECT * FROM account_deletion_reauth_tokens
WHERE user_id = sqlc.arg(user_id) AND idempotency_key = sqlc.arg(idempotency_key);

-- name: GetAccountDeletionReauthTokenForUpdate :one
SELECT * FROM account_deletion_reauth_tokens
WHERE token_hash = sqlc.arg(token_hash)
FOR UPDATE;

-- name: ConsumeAccountDeletionReauthToken :exec
UPDATE account_deletion_reauth_tokens SET consumed_at = now()
WHERE id = sqlc.arg(id) AND consumed_at IS NULL;

-- name: GetAccountDeletionRequestByUser :one
SELECT * FROM account_deletion_requests WHERE user_id = sqlc.arg(user_id);

-- name: CreateAccountDeletionRequest :one
INSERT INTO account_deletion_requests (
    id, user_id, idempotency_key, request_hash, status, accepted_at, backup_expires_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(idempotency_key), sqlc.arg(request_hash),
    'accepted', sqlc.arg(accepted_at), sqlc.arg(backup_expires_at)
)
RETURNING *;

-- name: CreateAccountDeletionStatusRecord :one
INSERT INTO account_deletion_status_records (
    request_id, replay_user_hash, idempotency_key_hash, request_hash,
    status_token_hash, status, accepted_at, backup_expires_at
) VALUES (
    sqlc.arg(request_id), sqlc.arg(replay_user_hash), sqlc.arg(idempotency_key_hash),
    sqlc.arg(request_hash), sqlc.arg(status_token_hash), 'accepted',
    sqlc.arg(accepted_at), sqlc.arg(backup_expires_at)
)
RETURNING *;

-- name: GetAccountDeletionReplayByKey :one
SELECT * FROM account_deletion_status_records
WHERE replay_user_hash = sqlc.arg(replay_user_hash)
  AND idempotency_key_hash = sqlc.arg(idempotency_key_hash);

-- name: MarkUserDeletionPending :exec
UPDATE users SET
    account_status = 'deletion_pending',
    suspended_at = NULL,
    suspension_expires_at = NULL,
    status_version = status_version + 1,
    updated_at = now()
WHERE id = sqlc.arg(id) AND account_status = 'active';

-- name: CancelUserOperationsForDeletion :exec
UPDATE async_operations SET
    status = 'cancelled',
    completed_at = now(),
    error = jsonb_build_object('code', 'ACCOUNT_DELETION_REQUESTED')
WHERE user_id = sqlc.arg(user_id) AND status IN ('queued', 'running');

-- name: GetAccountDeletionStatusByToken :one
SELECT * FROM account_deletion_status_records
WHERE request_id = sqlc.arg(request_id) AND status_token_hash = sqlc.arg(status_token_hash);

-- name: UpdateAccountDeletionStatus :exec
UPDATE account_deletion_status_records SET
    status = sqlc.arg(status),
    public_error = sqlc.narg(public_error),
    completed_at = CASE WHEN sqlc.arg(status) = 'completed' THEN now() ELSE completed_at END,
    updated_at = now()
WHERE request_id = sqlc.arg(request_id);
