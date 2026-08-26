-- +goose Up
-- 归档是一个 30 天可恢复窗口。恢复时清空 archived_at；到期任务只处理
-- archived_at 仍与任务匹配的自定义 Tracker，避免误删恢复后再次归档的数据。
ALTER TABLE trackers ADD COLUMN archived_at timestamptz;

UPDATE trackers
SET archived_at = updated_at
WHERE status = 'archived' AND archived_at IS NULL;

CREATE INDEX trackers_user_archived_at_idx
    ON trackers (user_id, archived_at)
    WHERE status = 'archived' AND deleted_at IS NULL AND builtin_key IS NULL;

-- +goose Down
DROP INDEX trackers_user_archived_at_idx;
ALTER TABLE trackers DROP COLUMN archived_at;
