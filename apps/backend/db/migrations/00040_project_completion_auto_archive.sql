-- +goose Up
-- 完成后的项目不再占用独立列表：历史 completed 项目并入归档。
-- status_before_archived 保留 completed 作为迁移标记；领域恢复逻辑会把它重新
-- 打开为 active，不会恢复成已经取消长期展示的 completed 状态。
UPDATE projects
SET status = 'archived',
    status_before_archived = 'completed',
    updated_at = now(),
    version = version + 1
WHERE status = 'completed'
  AND deleted_at IS NULL;

-- +goose Down
-- 数据迁移不可逆：无法可靠区分“升级时自动并入归档”和“用户此前手动归档”
-- 的 completed 项目。回滚代码版本时旧服务仍能读取 archived，因此不改写用户数据。
SELECT 1;
