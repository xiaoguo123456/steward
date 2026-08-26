-- name: ListTaskLists :many
SELECT tl.*,
       (SELECT count(*) FROM tasks t
        WHERE t.list_id = tl.id
          AND t.deleted_at IS NULL
          AND t.status IN ('todo', 'doing'))::int AS task_count
FROM task_lists tl
WHERE tl.deleted_at IS NULL
  AND (sqlc.arg(include_archived)::bool OR tl.archived_at IS NULL)
ORDER BY tl.position, tl.id;

-- name: ListTaskListsByKind :many
SELECT tl.*,
       (SELECT count(*) FROM tasks t
        WHERE t.list_id = tl.id
          AND t.deleted_at IS NULL
          AND t.status IN ('todo', 'doing'))::int AS task_count
FROM task_lists tl
WHERE tl.deleted_at IS NULL
  AND (sqlc.arg(include_archived)::bool OR tl.archived_at IS NULL)
  AND tl.list_kind = sqlc.arg(list_kind)::text
ORDER BY tl.position, tl.id;

-- name: GetTaskList :one
SELECT tl.*,
       (SELECT count(*) FROM tasks t
        WHERE t.list_id = tl.id
          AND t.deleted_at IS NULL
          AND t.status IN ('todo', 'doing'))::int AS task_count
FROM task_lists tl
WHERE tl.id = sqlc.arg(id) AND tl.deleted_at IS NULL;

-- name: GetTaskListForUpdate :one
SELECT * FROM task_lists
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
FOR UPDATE;

-- name: GetDefaultTaskList :one
SELECT * FROM task_lists
WHERE is_default
  AND list_kind = 'tasks'
  AND archived_at IS NULL
  AND deleted_at IS NULL
LIMIT 1;

-- name: GetDefaultTaskListForUpdate :one
SELECT * FROM task_lists
WHERE is_default
  AND list_kind = 'tasks'
  AND archived_at IS NULL
  AND deleted_at IS NULL
LIMIT 1
FOR UPDATE;

-- name: GetNextActiveTaskListForUpdate :one
SELECT * FROM task_lists
WHERE user_id = sqlc.arg(user_id)
  AND id <> sqlc.arg(excluded_id)
  AND list_kind = 'tasks'
  AND archived_at IS NULL
  AND deleted_at IS NULL
ORDER BY position, id
LIMIT 1
FOR UPDATE;

-- name: GetActiveShoppingTaskList :one
SELECT * FROM task_lists
WHERE user_id = sqlc.arg(user_id)
  AND list_kind = 'shopping'
  AND archived_at IS NULL
  AND deleted_at IS NULL
LIMIT 1;

-- name: CreateTaskList :one
INSERT INTO task_lists (id, user_id, name, color, icon, position, is_default, list_kind)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name),
    sqlc.narg(color), sqlc.narg(icon), sqlc.arg(position), sqlc.arg(is_default),
    sqlc.arg(list_kind)
)
RETURNING *;

-- name: CreateShoppingTaskListIfAbsent :one
INSERT INTO task_lists (id, user_id, name, color, icon, position, is_default, list_kind)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name),
    sqlc.narg(color), sqlc.narg(icon), sqlc.arg(position), false, 'shopping'
)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: UpdateTaskList :one
UPDATE task_lists SET
    name        = coalesce(sqlc.narg(name), name),
    color       = CASE WHEN sqlc.arg(clear_color)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(color), color) END,
    icon        = CASE WHEN sqlc.arg(clear_icon)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(icon), icon) END,
    position    = coalesce(sqlc.narg(position), position),
    archived_at = CASE WHEN sqlc.narg(archived)::bool IS NULL THEN archived_at
                       WHEN sqlc.narg(archived)::bool THEN coalesce(archived_at, now())
                       ELSE NULL END,
    is_default  = CASE WHEN sqlc.narg(archived)::bool IS TRUE THEN false
                       ELSE is_default END,
    updated_at  = now(),
    version     = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SetTaskListDefault :one
UPDATE task_lists SET
    is_default = true,
    updated_at = now(),
    version = version + 1
WHERE id = sqlc.arg(id)
  AND list_kind = 'tasks'
  AND archived_at IS NULL
  AND deleted_at IS NULL
RETURNING *;

-- name: ListExpiredArchivedTaskLists :many
SELECT * FROM task_lists
WHERE user_id = sqlc.arg(user_id)
  AND list_kind = 'tasks'
  AND NOT is_default
  AND archived_at IS NOT NULL
  AND archived_at <= sqlc.arg(archived_before)::timestamptz
  AND deleted_at IS NULL
ORDER BY archived_at, id;

-- name: SoftDeleteExpiredArchivedTaskList :one
UPDATE task_lists SET
    deleted_at = now(),
    updated_at = now(),
    version = version + 1
WHERE id = sqlc.arg(id)
  AND list_kind = 'tasks'
  AND NOT is_default
  AND archived_at IS NOT NULL
  AND archived_at <= sqlc.arg(archived_before)::timestamptz
  AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteTaskList :one
UPDATE task_lists SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: CountTasksInList :one
SELECT count(*)::int FROM tasks
WHERE list_id = sqlc.arg(list_id) AND deleted_at IS NULL;

-- name: MoveTasksToList :exec
UPDATE tasks SET list_id = sqlc.arg(target_list_id), updated_at = now(), version = version + 1
WHERE list_id = sqlc.arg(source_list_id) AND deleted_at IS NULL;

-- name: CountTaskLists :one
SELECT count(*)::int FROM task_lists
WHERE deleted_at IS NULL AND archived_at IS NULL;
