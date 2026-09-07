-- Action Proposal。模型只产建议，用户确认后才由 Domain Command 写入。

-- name: CreateProposal :one
INSERT INTO action_proposals (
    id, user_id, thread_id, turn_id, proposal_type,
    target_type, target_id, target_expected_version,
    command, preview, reason, source_refs, expires_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.narg(thread_id), sqlc.narg(turn_id),
    sqlc.arg(proposal_type), sqlc.narg(target_type), sqlc.narg(target_id),
    sqlc.narg(target_expected_version),
    sqlc.arg(command), sqlc.arg(preview), sqlc.arg(reason),
    sqlc.arg(source_refs), sqlc.arg(expires_at)
)
RETURNING *;

-- name: GetProposal :one
SELECT * FROM action_proposals WHERE id = sqlc.arg(id);

-- name: ListProposals :many
SELECT * FROM action_proposals
WHERE (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: ListProposalsForTurn :many
SELECT * FROM action_proposals WHERE turn_id = sqlc.arg(turn_id) ORDER BY created_at;

-- name: MarkProposalExecuted :one
UPDATE action_proposals SET
    status            = 'executed',
    executed_batch_id = sqlc.arg(executed_batch_id),
    updated_at        = now(),
    version           = version + 1
WHERE id = sqlc.arg(id) AND status = 'pending'
RETURNING *;

-- name: MarkProposalResolved :one
-- 用于 rejected、stale、expired、failed 等终态。
UPDATE action_proposals SET
    status     = sqlc.arg(status),
    error_code = sqlc.narg(error_code),
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND status = 'pending'
RETURNING *;

-- name: SupersedeProposalsForTarget :exec
-- 新建议明确替换同一目标上的旧建议时，把旧项标为 superseded。
UPDATE action_proposals SET status = 'superseded', updated_at = now(), version = version + 1
WHERE status = 'pending'
  AND target_type = sqlc.arg(target_type)
  AND target_id = sqlc.arg(target_id)
  AND id <> sqlc.arg(keep_id);

-- name: ExpireStaleProposals :exec
UPDATE action_proposals SET status = 'expired', updated_at = now()
WHERE status = 'pending' AND expires_at < now();

-- name: CountPendingProposals :one
SELECT count(*)::int FROM action_proposals WHERE status = 'pending' AND expires_at >= now();

-- name: LockProposal :one
-- 确认执行前先锁住这一行：并发的两次确认里只有一个能拿到锁，
-- 另一个会看到状态已变成 executed 而被拒绝。
SELECT * FROM action_proposals WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: ListPendingProposalsForThread :many
SELECT * FROM action_proposals
WHERE thread_id = sqlc.arg(thread_id) AND status = 'pending' AND expires_at >= now()
ORDER BY created_at DESC, id DESC LIMIT 20;
