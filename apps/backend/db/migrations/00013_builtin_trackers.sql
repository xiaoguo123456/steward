-- +goose Up
-- 内置记录项的稳定标识。
--
-- 运动、专注与记账三个生活场景需要固定的字段结构才能渲染专用界面。
-- 客户端按这个键找到对应记录项，不硬编码 ID，也不靠名称匹配
-- （用户可以改名）。
ALTER TABLE trackers ADD COLUMN builtin_key text;

ALTER TABLE trackers ADD CONSTRAINT trackers_builtin_key_check
    CHECK (builtin_key IS NULL OR builtin_key IN ('workout', 'focus', 'ledger'));

-- 每个用户每种内置记录项只有一个。
CREATE UNIQUE INDEX trackers_builtin_key_unique
    ON trackers (user_id, builtin_key)
    WHERE builtin_key IS NOT NULL AND deleted_at IS NULL;

-- +goose Down
DROP INDEX trackers_builtin_key_unique;
ALTER TABLE trackers DROP CONSTRAINT trackers_builtin_key_check;
ALTER TABLE trackers DROP COLUMN builtin_key;
