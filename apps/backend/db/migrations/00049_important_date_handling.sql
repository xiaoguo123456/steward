-- +goose Up
-- 过期是根据日期派生的展示状态；这里只保存用户明确确认过的“已处理”。

ALTER TABLE events
    ADD COLUMN important_date_handled_at timestamptz;

ALTER TABLE events
    ADD CONSTRAINT events_important_date_handled_scope CHECK (
        important_date_handled_at IS NULL
        OR (event_kind = 'important_date' AND recurrence = 'none')
    );

ALTER TABLE action_proposals
    DROP CONSTRAINT action_proposals_type_check;

ALTER TABLE action_proposals
    ADD CONSTRAINT action_proposals_type_check CHECK (proposal_type IN (
        'task_create', 'task_update', 'event_create', 'event_update', 'memory_upsert'
    ));

-- +goose Down
-- 旧版本无法解释 event_update；回滚时先移除对应的短期建议快照。
DELETE FROM action_proposals WHERE proposal_type = 'event_update';

ALTER TABLE action_proposals
    DROP CONSTRAINT action_proposals_type_check;

ALTER TABLE action_proposals
    ADD CONSTRAINT action_proposals_type_check CHECK (proposal_type IN (
        'task_create', 'task_update', 'event_create', 'memory_upsert'
    ));

ALTER TABLE events
    DROP CONSTRAINT events_important_date_handled_scope;

ALTER TABLE events
    DROP COLUMN important_date_handled_at;
