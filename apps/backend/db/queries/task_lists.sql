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

-- name: GetTaskList :one
SELECT tl.*,
       (SELECT count(*) FROM tasks t
        WHERE t.list_id = tl.id
          AND t.deleted_at IS NULL
          AND t.status IN ('todo', 'doing'))::int AS task_count
FROM task_lists tl
WHERE tl.id = sqlc.arg(id) AND tl.deleted_at IS NULL;

-- name: GetDefaultTaskList :one
SELECT * FROM task_lists
WHERE is_default AND deleted_at IS NULL
LIMIT 1;

-- name: CreateTaskList :one
INSERT INTO task_lists (id, user_id, name, color, icon, position, is_default)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name),
    sqlc.narg(color), sqlc.narg(icon), sqlc.arg(position), sqlc.arg(is_default)
)
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
    updated_at  = now(),
    version     = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
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
