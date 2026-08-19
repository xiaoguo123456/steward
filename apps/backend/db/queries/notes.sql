-- Note 查询。Note 没有完成状态，列表按置顶优先、更新时间倒序。

-- name: ListNotes :many
SELECT * FROM notes
WHERE deleted_at IS NULL
  AND (sqlc.narg(tag)::text IS NULL OR sqlc.narg(tag)::text = ANY (tags))
  AND (sqlc.narg(project_id)::text IS NULL OR project_id = sqlc.narg(project_id)::text)
  AND (sqlc.narg(query)::text IS NULL
       OR title ILIKE '%' || sqlc.narg(query)::text || '%'
       OR content ILIKE '%' || sqlc.narg(query)::text || '%')
  AND (sqlc.narg(cursor_updated_at)::timestamptz IS NULL
       OR (updated_at, id) < (sqlc.narg(cursor_updated_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY pinned_at DESC NULLS LAST, updated_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetNote :one
SELECT * FROM notes WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: CreateNote :one
INSERT INTO notes (
    id, user_id, title, content, attachments, tags, pinned_at,
    project_id, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.arg(content),
    sqlc.arg(attachments), sqlc.arg(tags), sqlc.narg(pinned_at),
    sqlc.narg(project_id), sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateNote :one
UPDATE notes SET
    title      = coalesce(sqlc.narg(title), title),
    content    = coalesce(sqlc.narg(content), content),
    tags       = coalesce(sqlc.narg(tags), tags),
    pinned_at  = CASE WHEN sqlc.narg(pinned)::bool IS NULL THEN pinned_at
                      WHEN sqlc.narg(pinned)::bool THEN coalesce(pinned_at, now())
                      ELSE NULL END,
    project_id = CASE WHEN sqlc.arg(clear_project_id)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(project_id), project_id) END,
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteNote :one
UPDATE notes SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: RestoreNote :one
UPDATE notes SET deleted_at = NULL, updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ClearProjectFromNotes :exec
UPDATE notes SET project_id = NULL, updated_at = now(), version = version + 1
WHERE project_id = sqlc.arg(project_id) AND deleted_at IS NULL;

-- name: ListNoteTags :many
SELECT DISTINCT unnest(tags)::text AS tag FROM notes
WHERE deleted_at IS NULL
ORDER BY tag;

-- name: SearchNotes :many
SELECT id, title, content, updated_at FROM notes
WHERE deleted_at IS NULL
  AND (title ILIKE '%' || sqlc.arg(query)::text || '%'
       OR content ILIKE '%' || sqlc.arg(query)::text || '%')
ORDER BY updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: CountNotesCreatedBetween :one
SELECT count(*)::int FROM notes
WHERE deleted_at IS NULL
  AND created_at >= sqlc.arg(from_at)::timestamptz
  AND created_at < sqlc.arg(to_at)::timestamptz;
