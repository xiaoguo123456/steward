-- 长期记忆。只有用户确认过的条目才是 active，Context Builder 只读 active。

-- name: CreateMemory :one
INSERT INTO memory_items (
    id, user_id, memory_key, memory_type, value, canonical_text,
    sensitivity, origin, status, confirmed_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(memory_key), sqlc.arg(memory_type),
    sqlc.arg(value), sqlc.arg(canonical_text),
    sqlc.arg(sensitivity), sqlc.arg(origin), 'active', now()
)
RETURNING *;

-- name: GetMemory :one
SELECT * FROM memory_items WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GetActiveMemoryByKey :one
SELECT * FROM memory_items
WHERE memory_key = sqlc.arg(memory_key) AND status = 'active';

-- name: ListMemories :many
SELECT * FROM memory_items
WHERE deleted_at IS NULL
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(memory_type)::text IS NULL OR memory_type = sqlc.narg(memory_type)::text)
ORDER BY updated_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: SearchMemories :many
-- Context Builder 用：先做确定性过滤，再按相关性排序。
-- 高敏记忆默认不参与检索，只有当前功能确实需要且策略允许时才单独读取。
SELECT * FROM memory_items
WHERE status = 'active'
  AND sensitivity = ANY (sqlc.arg(allowed_sensitivity)::text[])
  AND (valid_from IS NULL OR valid_from <= now())
  AND (valid_until IS NULL OR valid_until > now())
  AND (sqlc.narg(query)::text IS NULL
       OR canonical_text ILIKE '%' || sqlc.narg(query)::text || '%')
ORDER BY
    -- 用户明确说出的优先于推断得到的。
    CASE origin WHEN 'explicit' THEN 0 ELSE 1 END,
    coalesce(last_used_at, confirmed_at, created_at) DESC
LIMIT sqlc.arg(row_limit);

-- name: UpdateMemoryValue :one
UPDATE memory_items SET
    value          = sqlc.arg(value),
    canonical_text = sqlc.arg(canonical_text),
    confirmed_at   = now(),
    updated_at     = now(),
    version        = version + 1
WHERE id = sqlc.arg(id) AND status = 'active'
RETURNING *;

-- name: SupersedeMemory :one
UPDATE memory_items SET status = 'superseded', updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND status = 'active'
RETURNING *;

-- name: DeleteMemory :one
-- 同步标记删除，查询立即不可见；派生数据由清理任务处理。
UPDATE memory_items SET
    status     = 'deleted',
    deleted_at = now(),
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: TouchMemoryUsed :exec
-- 记录被使用的时间用于排序。被模型引用不提高事实可信度。
UPDATE memory_items SET last_used_at = now()
WHERE id = ANY (sqlc.arg(ids)::text[]);

-- name: CreateMemoryRevision :exec
INSERT INTO memory_revisions (
    id, user_id, memory_id, revision, value, canonical_text, change_kind, changed_by, proposal_id
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(memory_id), sqlc.arg(revision),
    sqlc.narg(value), sqlc.narg(canonical_text),
    sqlc.arg(change_kind), sqlc.arg(changed_by), sqlc.narg(proposal_id)
);

-- name: ListMemoryRevisions :many
SELECT * FROM memory_revisions WHERE memory_id = sqlc.arg(memory_id) ORDER BY revision DESC;

-- name: CreateMemoryEvidence :exec
INSERT INTO memory_evidence (
    id, user_id, memory_id, memory_version, source_type, source_id, source_version, locator, evidence_role
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(memory_id), sqlc.arg(memory_version),
    sqlc.arg(source_type), sqlc.arg(source_id), sqlc.narg(source_version),
    sqlc.narg(locator), sqlc.arg(evidence_role)
);

-- name: ListMemoryEvidence :many
SELECT * FROM memory_evidence
WHERE memory_id = sqlc.arg(memory_id) AND deleted_at IS NULL
ORDER BY created_at;

-- name: CreateRelearnBlock :exec
-- 只保存指纹，不保存明文；用于阻止已删除语义被自动再次建议。
INSERT INTO memory_relearn_blocks (id, user_id, memory_key, value_fingerprint)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(memory_key), sqlc.arg(value_fingerprint))
ON CONFLICT (user_id, memory_key, value_fingerprint) DO NOTHING;

-- name: IsRelearnBlocked :one
SELECT EXISTS (
    SELECT 1 FROM memory_relearn_blocks
    WHERE memory_key = sqlc.arg(memory_key)
      AND value_fingerprint = sqlc.arg(value_fingerprint)
      AND (expires_at IS NULL OR expires_at > now())
)::bool AS blocked;

-- name: ListRelearnBlocks :many
SELECT * FROM memory_relearn_blocks ORDER BY blocked_at DESC LIMIT sqlc.arg(row_limit);

-- name: DeleteRelearnBlock :one
DELETE FROM memory_relearn_blocks WHERE id = sqlc.arg(id)
RETURNING *;
