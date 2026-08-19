-- +goose Up
-- 重要日的四种预设。
--
-- 它不新增领域类型：重要日仍然是 event_kind=important_date 的全天 Event。
-- 这个字段只决定图标与表单默认值，列表里要显示类型图标就必须能读回来。
ALTER TABLE events ADD COLUMN important_date_kind text;

ALTER TABLE events ADD CONSTRAINT events_important_date_kind_check
    CHECK (important_date_kind IS NULL
           OR important_date_kind IN ('birthday', 'anniversary', 'expiry', 'other'));

-- 只有重要日才允许带预设，避免普通日程被塞进无意义的值。
ALTER TABLE events ADD CONSTRAINT events_important_date_kind_scope
    CHECK (important_date_kind IS NULL OR event_kind = 'important_date');

-- +goose Down
ALTER TABLE events DROP CONSTRAINT events_important_date_kind_scope;
ALTER TABLE events DROP CONSTRAINT events_important_date_kind_check;
ALTER TABLE events DROP COLUMN important_date_kind;
