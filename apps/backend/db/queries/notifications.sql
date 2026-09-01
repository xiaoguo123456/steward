-- 产品内通知中心。

-- name: UpsertNotification :exec
INSERT INTO notifications (
    id, user_id, notification_type, title, body, source_type, source_id, occurred_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(notification_type), sqlc.arg(title),
    sqlc.arg(body), sqlc.arg(source_type), sqlc.arg(source_id), sqlc.arg(occurred_at)
)
ON CONFLICT (id) DO NOTHING;

-- name: ListNotifications :many
SELECT n.*,
       CASE n.source_type
           WHEN 'task' THEN NOT EXISTS (
               SELECT 1 FROM tasks t WHERE t.id = n.source_id AND t.deleted_at IS NULL
           )
           WHEN 'event' THEN NOT EXISTS (
               SELECT 1 FROM events e WHERE e.id = n.source_id AND e.deleted_at IS NULL
           )
           WHEN 'project' THEN NOT EXISTS (
               SELECT 1 FROM projects p WHERE p.id = n.source_id AND p.deleted_at IS NULL
           )
           ELSE false
       END AS source_deleted
FROM notifications n
WHERE (sqlc.narg(cursor_occurred_at)::timestamptz IS NULL
       OR (n.occurred_at, n.id) < (
           sqlc.narg(cursor_occurred_at)::timestamptz,
           sqlc.narg(cursor_id)::text
       ))
ORDER BY n.occurred_at DESC, n.id DESC
LIMIT sqlc.arg(row_limit);

-- name: MarkNotificationRead :one
WITH updated AS (
    UPDATE notifications AS n
    SET read_at = coalesce(n.read_at, now())
    WHERE n.id = sqlc.arg(notification_id)
    RETURNING n.*
)
SELECT updated.*,
       CASE updated.source_type
           WHEN 'task' THEN NOT EXISTS (
               SELECT 1 FROM tasks t WHERE t.id = updated.source_id AND t.deleted_at IS NULL
           )
           WHEN 'event' THEN NOT EXISTS (
               SELECT 1 FROM events e WHERE e.id = updated.source_id AND e.deleted_at IS NULL
           )
           WHEN 'project' THEN NOT EXISTS (
               SELECT 1 FROM projects p WHERE p.id = updated.source_id AND p.deleted_at IS NULL
           )
           ELSE false
       END AS source_deleted
FROM updated;
