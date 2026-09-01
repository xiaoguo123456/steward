-- Project 查询。progress 由 Task 计数在应用层计算，不落库。

-- name: ListProjects :many
SELECT * FROM projects
WHERE deleted_at IS NULL
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(project_kind)::text IS NULL OR project_kind = sqlc.narg(project_kind)::text)
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetProject :one
SELECT * FROM projects WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GetProjectForUpdate :one
SELECT * FROM projects WHERE id = sqlc.arg(id) AND deleted_at IS NULL FOR UPDATE;

-- name: CreateProject :one
INSERT INTO projects (
    id, user_id, title, description, status, start_date, target_date,
    project_kind, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.narg(description),
    sqlc.arg(status), sqlc.narg(start_date), sqlc.narg(target_date),
    sqlc.arg(project_kind), sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateProject :one
UPDATE projects SET
    title        = coalesce(sqlc.narg(title), title),
    project_kind = coalesce(sqlc.narg(project_kind), project_kind),
    description = CASE WHEN sqlc.arg(clear_description)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(description), description) END,
    status      = coalesce(sqlc.narg(status), status),
    -- 归档时记录归档前状态，恢复时用它还原。
    status_before_archived = CASE
        WHEN sqlc.narg(status)::text = 'archived' AND status <> 'archived' THEN status
        WHEN sqlc.narg(status)::text IS NOT NULL AND sqlc.narg(status)::text <> 'archived' THEN NULL
        ELSE status_before_archived END,
    start_date  = CASE WHEN sqlc.arg(clear_start_date)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(start_date), start_date) END,
    target_date = CASE WHEN sqlc.arg(clear_target_date)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(target_date), target_date) END,
    updated_at  = now(),
    version     = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteProject :one
UPDATE projects SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SearchProjects :many
SELECT id, title, updated_at FROM projects
WHERE deleted_at IS NULL AND title ILIKE '%' || sqlc.arg(query)::text || '%'
ORDER BY updated_at DESC
LIMIT sqlc.arg(row_limit);
