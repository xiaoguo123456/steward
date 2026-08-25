-- +goose Up
-- 自定义打卡项的频率。NULL 表示不定期；内置记录项由各自场景负责，不设置频率。
ALTER TABLE trackers ADD COLUMN schedule jsonb;

ALTER TABLE trackers ADD CONSTRAINT trackers_schedule_check CHECK (
    schedule IS NULL OR (
        jsonb_typeof(schedule) = 'object'
        AND schedule ->> 'frequency' IN ('daily', 'weekly')
        AND (
            schedule ->> 'frequency' = 'daily'
            OR (
                jsonb_typeof(schedule -> 'weekdays') = 'array'
                AND jsonb_array_length(schedule -> 'weekdays') BETWEEN 1 AND 7
            )
        )
    )
);

-- +goose Down
ALTER TABLE trackers DROP CONSTRAINT trackers_schedule_check;
ALTER TABLE trackers DROP COLUMN schedule;
