-- Assistant 对话。系统权威会话是这些表，Provider 状态只是可丢弃的优化列。

-- name: CreateThread :one
INSERT INTO assistant_threads (id, user_id, title, created_for_default)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.arg(created_for_default))
RETURNING *;

-- name: LockAssistantThreadCreation :exec
-- 同一用户的默认 Thread 创建必须串行：两个设备同时发出当天第一条消息时，
-- 都要先完成「查询当天 Thread → 必要时创建」这段临界区。
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(user_id)::text, 0));

-- name: GetCurrentDayThread :one
-- 默认入口只认当地自然日内真正发生过的用户消息。
-- Assistant 回复跨过午夜完成不能把昨天的 Thread 变成今天的默认对话。
WITH current_day_activity AS (
    SELECT thread_id, max(created_at) AS last_user_message_at
    FROM assistant_messages
    WHERE deleted_at IS NULL
      AND role = 'user'
      AND created_at >= sqlc.arg(day_start)::timestamptz
      AND created_at < sqlc.arg(day_end)::timestamptz
    GROUP BY thread_id
)
SELECT t.*
FROM assistant_threads t
JOIN current_day_activity a ON a.thread_id = t.id
WHERE t.deleted_at IS NULL AND t.status = 'active'
ORDER BY a.last_user_message_at DESC, t.id DESC
LIMIT 1;

-- name: GetCurrentDayEmptyThread :one
-- 创建 Thread 后发送可能因网络失败没有发生；当天重试时复用这个不可见空壳，
-- 不让并发设备或重试不断产生新的空 Thread。
SELECT * FROM assistant_threads
WHERE deleted_at IS NULL
  AND status = 'active'
  AND last_message_seq = 0
  AND created_for_default
  AND created_at >= sqlc.arg(day_start)::timestamptz
  AND created_at < sqlc.arg(day_end)::timestamptz
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: GetThread :one
SELECT * FROM assistant_threads
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: ListThreads :many
-- 只返回真正说过话的对话。用户打开面板又直接关掉不算一次对话，
-- 那种空壳出现在历史里只会让列表全是「新对话」。
SELECT * FROM assistant_threads
WHERE deleted_at IS NULL
  AND last_message_seq > 0
  AND (sqlc.arg(include_archived)::bool OR status = 'active')
  AND (sqlc.narg(cursor_updated_at)::timestamptz IS NULL
       OR (updated_at, id) < (sqlc.narg(cursor_updated_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY updated_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: UpdateThread :one
UPDATE assistant_threads SET
    title      = coalesce(sqlc.narg(title), title),
    status     = coalesce(sqlc.narg(status), status),
    archived_at = CASE WHEN sqlc.narg(status)::text = 'archived' THEN coalesce(archived_at, now())
                       WHEN sqlc.narg(status)::text = 'active' THEN NULL
                       ELSE archived_at END,
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteThread :one
UPDATE assistant_threads SET status = 'deleted', deleted_at = now(), updated_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: AdvanceThreadSeq :one
-- 在同一事务内原子分配消息与 Turn 序号，避免并发下产生重复序号。
UPDATE assistant_threads SET
    last_message_seq = last_message_seq + sqlc.arg(message_delta)::int,
    last_turn_seq    = last_turn_seq + sqlc.arg(turn_delta)::int,
    updated_at       = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING last_message_seq, last_turn_seq;

-- name: CreateMessage :one
INSERT INTO assistant_messages (
    id, user_id, thread_id, message_seq, role, content, status, turn_id, completed_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(thread_id), sqlc.arg(message_seq),
    sqlc.arg(role), sqlc.arg(content), sqlc.arg(status), sqlc.narg(turn_id), sqlc.narg(completed_at)
)
RETURNING *;

-- name: ListMessages :many
SELECT * FROM assistant_messages
WHERE thread_id = sqlc.arg(thread_id) AND deleted_at IS NULL
  AND (sqlc.narg(cursor_seq)::int IS NULL OR message_seq < sqlc.narg(cursor_seq)::int)
ORDER BY message_seq DESC
LIMIT sqlc.arg(row_limit);

-- name: ListRecentMessages :many
-- Context Builder 用：按序取最近若干轮原始消息。
SELECT * FROM assistant_messages
WHERE thread_id = sqlc.arg(thread_id) AND deleted_at IS NULL AND status = 'completed'
ORDER BY message_seq DESC
LIMIT sqlc.arg(row_limit);

-- name: CreateTurn :one
INSERT INTO assistant_turns (
    id, user_id, thread_id, turn_seq, user_message_id, operation_id, status, engine_type, model_policy
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(thread_id), sqlc.arg(turn_seq),
    sqlc.arg(user_message_id), sqlc.arg(operation_id), 'queued',
    sqlc.arg(engine_type), sqlc.arg(model_policy)
)
RETURNING *;

-- name: GetTurn :one
SELECT * FROM assistant_turns WHERE id = sqlc.arg(id);

-- name: StartTurn :one
-- 允许从 running 重新接管：保存结果的事务失败时 Turn 会停在 running，
-- 若只接受 queued，River 重试会直接跳过，用户的 Operation 永远停在排队中。
UPDATE assistant_turns SET status = 'running', started_at = coalesce(started_at, now()), version = version + 1
WHERE id = sqlc.arg(id) AND status IN ('queued', 'running')
RETURNING *;

-- name: FinishTurn :one
UPDATE assistant_turns SET
    status               = sqlc.arg(status),
    mode                 = sqlc.narg(mode),
    assistant_message_id = sqlc.narg(assistant_message_id),
    error_code           = sqlc.narg(error_code),
    completed_at         = now(),
    version              = version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CancelTurn :one
UPDATE assistant_turns SET status = 'cancelled', completed_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND status IN ('queued', 'running')
RETURNING *;

-- name: RecordToolCall :exec
INSERT INTO ai_tool_calls (
    id, user_id, turn_id, call_seq, capability_name, risk,
    arguments_hash, result_hash, result_summary, source_refs, status, error_code, duration_ms
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(turn_id), sqlc.arg(call_seq),
    sqlc.arg(capability_name), sqlc.arg(risk),
    sqlc.narg(arguments_hash), sqlc.narg(result_hash), sqlc.narg(result_summary),
    sqlc.arg(source_refs), sqlc.arg(status), sqlc.narg(error_code), sqlc.arg(duration_ms)
);

-- name: ListToolCalls :many
SELECT * FROM ai_tool_calls WHERE turn_id = sqlc.arg(turn_id) ORDER BY call_seq;

-- name: TouchThread :exec
UPDATE assistant_threads SET updated_at = now() WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: SoftDeleteMessagesByThread :exec
UPDATE assistant_messages SET deleted_at = now()
WHERE thread_id = sqlc.arg(thread_id) AND deleted_at IS NULL;

-- name: SupersedeOlderTurns :exec
-- 同一 Thread 只让最新一轮继续跑。用户改口后旧的排队轮次直接作废，
-- 避免迟到的回复打乱上下文顺序。已生成的建议不受影响，仍需用户显式处理。
WITH superseded AS (
UPDATE assistant_turns SET status = 'superseded', completed_at = now(), version = version + 1
WHERE thread_id = sqlc.arg(thread_id)
  AND turn_seq < sqlc.arg(turn_seq)
  AND status IN ('queued', 'running')
RETURNING operation_id
)
UPDATE async_operations SET status = 'cancelled', progress = 100, completed_at = now()
WHERE id IN (SELECT operation_id FROM superseded)
  AND status IN ('queued', 'running');

-- name: SaveTurnEntryContext :exec
-- provider_state 存客户端页面上下文，只用于消歧；执行前仍会重新校验归属与版本。
UPDATE assistant_turns SET provider_state = sqlc.arg(provider_state)
WHERE id = sqlc.arg(id);

-- name: SetTurnEngine :exec
UPDATE assistant_turns
SET engine_type = sqlc.arg(engine_type), engine_version = sqlc.arg(engine_version)
WHERE id = sqlc.arg(id);

-- name: SetThreadTitleIfDefault :exec
-- 首条消息定标题。只在标题还是默认值时写，用户改过就不再覆盖。
UPDATE assistant_threads SET title = sqlc.arg(title), updated_at = now()
WHERE id = sqlc.arg(id) AND title = sqlc.arg(default_title);

-- name: DeleteAbandonedThreads :exec
-- 清理当前用户没说过话的空对话。正常路径下客户端只在发第一条消息时建对话，
-- 这里兜住「建完之后发送失败」留下的空壳。
--
-- 有意做成用户自己触发、受 RLS 约束：跨用户的定期清理需要维护角色，
-- 而这点垃圾量不值得为它引入一条绕过 RLS 的路径。
DELETE FROM assistant_threads
WHERE last_message_seq = 0 AND created_at < now() - interval '24 hours';

-- name: UpdateTurnDraft :exec
-- 覆盖式更新流式草稿。调用方按固定间隔节流，不是每个增量都写。
UPDATE assistant_turns SET draft_content = sqlc.arg(draft_content)
WHERE id = sqlc.arg(id) AND status = 'running';

-- name: SetMessageInteraction :exec
UPDATE assistant_messages SET interaction = sqlc.arg(interaction) WHERE id = sqlc.arg(id);

-- name: GetAssistantMessage :one
SELECT * FROM assistant_messages WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: LockAssistantThread :one
SELECT * FROM assistant_threads WHERE id = sqlc.arg(id) AND status <> 'deleted' FOR UPDATE;
