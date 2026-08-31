-- 时光查询。发布后没有 UPDATE：只允许创建、读取和整段软删除。

-- name: CreateMemoryMoment :one
INSERT INTO memory_moments (id, user_id, occurred_on, title, story, created_by)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(occurred_on),
    sqlc.arg(title), sqlc.arg(story), sqlc.arg(created_by)
)
RETURNING *;

-- name: CreateMemoryMomentPhoto :one
INSERT INTO memory_moment_photos (
    moment_id, user_id, media_id, position, description
) VALUES (
    sqlc.arg(moment_id), sqlc.arg(user_id), sqlc.arg(media_id),
    sqlc.arg(position), sqlc.arg(description)
)
RETURNING *;

-- name: ListMemoryMoments :many
SELECT * FROM memory_moments
WHERE deleted_at IS NULL
  AND (sqlc.narg(from_date)::date IS NULL OR occurred_on >= sqlc.narg(from_date)::date)
  AND (sqlc.narg(to_date)::date IS NULL OR occurred_on <= sqlc.narg(to_date)::date)
  AND (sqlc.narg(cursor_occurred_on)::date IS NULL
       OR (occurred_on, id) < (sqlc.narg(cursor_occurred_on)::date, sqlc.narg(cursor_id)::text))
ORDER BY occurred_on DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetMemoryMoment :one
SELECT * FROM memory_moments
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: ListMemoryMomentPhotos :many
SELECT
    p.moment_id, p.media_id, p.position, p.description,
    m.object_key, m.content_type, m.byte_size
FROM memory_moment_photos p
JOIN media_assets m ON m.id = p.media_id
WHERE p.moment_id = sqlc.arg(moment_id)
  AND m.status = 'uploaded'
  AND m.deleted_at IS NULL
ORDER BY p.position;

-- name: ListMemoryMomentPhotosForMoments :many
SELECT
    p.moment_id, p.media_id, p.position, p.description,
    m.object_key, m.content_type, m.byte_size
FROM memory_moment_photos p
JOIN media_assets m ON m.id = p.media_id
WHERE p.moment_id = ANY (sqlc.arg(moment_ids)::text[])
  AND m.status = 'uploaded'
  AND m.deleted_at IS NULL
ORDER BY p.moment_id, p.position;

-- name: SoftDeleteMemoryMoment :one
UPDATE memory_moments
SET deleted_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: IsMediaReferencedByActiveMemoryMoment :one
SELECT EXISTS (
    SELECT 1
    FROM memory_moment_photos p
    JOIN memory_moments m ON m.id = p.moment_id
    WHERE p.media_id = sqlc.arg(media_id)
      AND m.deleted_at IS NULL
);
