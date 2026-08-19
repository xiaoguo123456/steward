-- 媒体资产。二进制内容在对象存储，这里只保存受控引用与元数据。

-- name: CreateMediaAsset :one
INSERT INTO media_assets (id, user_id, object_key, kind, content_type, status)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(object_key),
    sqlc.arg(kind), sqlc.arg(content_type), 'pending'
)
RETURNING *;

-- name: GetMediaAsset :one
SELECT * FROM media_assets
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: MarkMediaUploaded :one
-- byte_size 与 content_hash 来自服务端对存储侧的回查，不采信客户端上报值。
UPDATE media_assets SET
    status       = 'uploaded',
    byte_size    = sqlc.arg(byte_size),
    content_hash = sqlc.narg(content_hash),
    content_type = coalesce(sqlc.narg(content_type), content_type),
    uploaded_at  = now(),
    error        = NULL
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: MarkMediaFailed :exec
UPDATE media_assets SET status = 'failed', error = sqlc.arg(error)
WHERE id = sqlc.arg(id);

-- name: FindUploadedMediaByHash :one
-- 同一用户上传相同内容时复用已有资产，避免重复占用存储。
SELECT * FROM media_assets
WHERE content_hash = sqlc.arg(content_hash)
  AND status = 'uploaded'
  AND deleted_at IS NULL
ORDER BY created_at
LIMIT 1;

-- name: SoftDeleteMediaAsset :one
UPDATE media_assets SET status = 'deleted', deleted_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: ListPendingMediaBefore :many
-- 长期停留在 pending 的资产说明客户端放弃了上传，交给清理任务回收。
SELECT * FROM media_assets
WHERE status = 'pending' AND created_at < sqlc.arg(created_before)
ORDER BY created_at
LIMIT sqlc.arg(row_limit);
