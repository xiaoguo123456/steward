-- +goose Up
-- AI 拆分作为一条批量 Proposal 确认：确认前不创建 Task，确认事务内同时建立关联。
ALTER TABLE action_proposals DROP CONSTRAINT action_proposals_type_check;
ALTER TABLE action_proposals
    ADD CONSTRAINT action_proposals_type_check CHECK (proposal_type IN (
        'task_create', 'task_update', 'task_split', 'event_create', 'event_update', 'memory_upsert'
    ));

-- +goose Down
DELETE FROM action_proposals WHERE proposal_type = 'task_split';
ALTER TABLE action_proposals DROP CONSTRAINT action_proposals_type_check;
ALTER TABLE action_proposals
    ADD CONSTRAINT action_proposals_type_check CHECK (proposal_type IN (
        'task_create', 'task_update', 'event_create', 'event_update', 'memory_upsert'
    ));
