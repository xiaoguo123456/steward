-- +goose Up
-- 用户消掉过哪些提醒。
--
-- 提醒本身不是行，而是 tasks/events 的 reminders 里一条规则加上一次「发生」
-- 算出来的时刻。所以这里存的不是提醒，而是**用户已经处理过这一次发生**。
--
-- 为什么需要它：不记的话，一条提醒到点之后每次打开 App 都会再浮出来一遍，
-- 用户消掉也没用。而重复打扰是这类功能最快被关掉的原因。
CREATE TABLE reminder_dismissals (
    id      text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- 来源事项。不加外键：来源被删除时这条记录留着无害，
    -- 而算待提醒时本来就只看还存在的事项。
    source_type text NOT NULL,
    source_id   text NOT NULL,
    -- 对应 reminders 数组里那一条的 id。
    reminder_id text NOT NULL,
    -- 这一次发生的日期。重要日每年重复，靠它区分「今年这次」和「去年那次」。
    occurrence_date date NOT NULL,

    dismissed_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reminder_dismissals_source_check
        CHECK (source_type IN ('task', 'event')),
    CONSTRAINT reminder_dismissals_unique
        UNIQUE (user_id, reminder_id, occurrence_date)
);

CREATE INDEX reminder_dismissals_user_idx
    ON reminder_dismissals (user_id, occurrence_date DESC);

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE 'ALTER TABLE reminder_dismissals ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE reminder_dismissals FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY reminder_dismissals_user_isolation ON reminder_dismissals '
            'USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))';
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS reminder_dismissals;
