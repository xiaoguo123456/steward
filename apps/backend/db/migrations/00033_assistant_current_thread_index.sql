-- +goose Up
-- 标记由默认入口创建、但还没有成功发送消息的 Thread。
-- 显式“新对话”保持 false，避免另一台设备把它当作可复用空壳接管。
ALTER TABLE assistant_threads
    ADD COLUMN created_for_default boolean NOT NULL DEFAULT false;

-- 默认打开 Assistant 时按用户时区的当天边界查找最近一条用户消息。
-- 只索引仍可见的 user Message，避免历史增长后每次打开面板都扫描全部消息。
CREATE INDEX assistant_messages_user_day_idx
    ON assistant_messages (user_id, created_at DESC, thread_id)
    WHERE deleted_at IS NULL AND role = 'user';

-- +goose Down
DROP INDEX assistant_messages_user_day_idx;
ALTER TABLE assistant_threads DROP COLUMN created_for_default;
