-- 异步 Operation、Activity、幂等与 AI 审计。

-- name: CreateOperation :one
INSERT INTO async_operations (id, user_id, kind, status, progress)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(kind), 'queued', 0)
RETURNING *;

-- name: GetOperation :one
SELECT * FROM async_operations WHERE id = sqlc.arg(id);

-- name: UpdateOperationStatus :one
UPDATE async_operations SET
    status       = sqlc.arg(status),
    progress     = coalesce(sqlc.narg(progress), progress),
    result_ref   = coalesce(sqlc.narg(result_ref), result_ref),
    error        = sqlc.narg(error),
    completed_at = CASE WHEN sqlc.arg(status) IN ('succeeded', 'failed', 'cancelled')
                        THEN now() ELSE completed_at END
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CreateActivityBatch :one
INSERT INTO activity_batches (id, user_id, source, source_id, undoable)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(source), sqlc.narg(source_id), sqlc.arg(undoable))
RETURNING *;

-- name: GetActivityBatch :one
SELECT * FROM activity_batches WHERE id = sqlc.arg(id);

-- name: ListActivityBatches :many
SELECT * FROM activity_batches
WHERE (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: MarkActivityBatchUndone :one
UPDATE activity_batches SET undone_at = now(), undoable = false
WHERE id = sqlc.arg(id) AND undone_at IS NULL
RETURNING *;

-- name: CreateActivityEntry :one
INSERT INTO activity_entries (
    id, user_id, batch_id, action, resource_type, resource_id,
    title, summary, before_state, after_state, position
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(batch_id), sqlc.arg(action),
    sqlc.arg(resource_type), sqlc.arg(resource_id), sqlc.arg(title), sqlc.arg(summary),
    sqlc.narg(before_state), sqlc.narg(after_state), sqlc.arg(position)
)
RETURNING *;

-- name: ListActivityEntries :many
SELECT * FROM activity_entries
WHERE batch_id = sqlc.arg(batch_id)
ORDER BY position, id;

-- name: ListActivityEntriesForBatches :many
SELECT * FROM activity_entries
WHERE batch_id = ANY (sqlc.arg(batch_ids)::text[])
ORDER BY batch_id, position, id;

-- name: GetIdempotencyRecord :one
SELECT * FROM idempotency_keys
WHERE user_id = sqlc.arg(user_id) AND endpoint = sqlc.arg(endpoint) AND key = sqlc.arg(key);

-- name: SaveIdempotencyRecord :exec
INSERT INTO idempotency_keys (
    user_id, endpoint, key, request_hash, status_code, response_body, resource_id, expires_at
) VALUES (
    sqlc.arg(user_id), sqlc.arg(endpoint), sqlc.arg(key), sqlc.arg(request_hash),
    sqlc.arg(status_code), sqlc.arg(response_body), sqlc.narg(resource_id), sqlc.arg(expires_at)
)
ON CONFLICT (user_id, endpoint, key) DO NOTHING;

-- name: DeleteExpiredIdempotencyRecords :exec
DELETE FROM idempotency_keys WHERE expires_at < now();

-- name: GetProcessedJob :one
SELECT * FROM processed_jobs WHERE idempotency_key = sqlc.arg(idempotency_key);

-- name: SaveProcessedJob :exec
INSERT INTO processed_jobs (idempotency_key, user_id, kind, result_ref)
VALUES (sqlc.arg(idempotency_key), sqlc.arg(user_id), sqlc.arg(kind), sqlc.narg(result_ref))
ON CONFLICT (idempotency_key) DO NOTHING;

-- name: RecordAiAction :exec
INSERT INTO ai_actions (
    id, user_id, feature, run_id, engine_type, engine_version, provider,
    model_policy, provider_model, prompt_version, schema_version,
    input_refs, input_hash, output_hash, status, error_class,
    input_tokens, output_tokens, estimated_cost, latency_ms, confirmation_outcome
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(feature), sqlc.arg(run_id),
    sqlc.arg(engine_type), sqlc.arg(engine_version), sqlc.arg(provider),
    sqlc.arg(model_policy), sqlc.arg(provider_model), sqlc.arg(prompt_version), sqlc.arg(schema_version),
    sqlc.arg(input_refs), sqlc.narg(input_hash), sqlc.narg(output_hash),
    sqlc.arg(status), sqlc.narg(error_class),
    sqlc.arg(input_tokens), sqlc.arg(output_tokens), sqlc.arg(estimated_cost),
    sqlc.arg(latency_ms), sqlc.narg(confirmation_outcome)
);
