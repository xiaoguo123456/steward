-- +goose Up
-- 清单归档是可恢复窗口。到期后先把任务迁入当时的默认清单，再软删除清单。
-- 历史数据里若存在已归档的默认清单，先取消内部默认标记，避免后续补建落点时
-- 命中唯一索引。
UPDATE task_lists
SET is_default = false, updated_at = now(), version = version + 1
WHERE list_kind = 'tasks'
  AND is_default
  AND archived_at IS NOT NULL
  AND deleted_at IS NULL;

CREATE INDEX task_lists_user_archived_at_idx
    ON task_lists (user_id, archived_at)
    WHERE list_kind = 'tasks'
      AND archived_at IS NOT NULL
      AND deleted_at IS NULL
      AND NOT is_default;

-- +goose Down
DROP INDEX task_lists_user_archived_at_idx;
