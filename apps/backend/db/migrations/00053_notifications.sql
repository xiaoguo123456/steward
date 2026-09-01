-- +goose Up
-- 产品内通知是已经发生的提醒快照，与仍会随 Object 变化的 reminder 规则分开。
-- 因此来源软删除后仍保留最小标题和发生时间，但不保存正文或敏感 payload。
CREATE TABLE notifications (
    id              text PRIMARY KEY,
    user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    title           text NOT NULL,
    body            text NOT NULL,
    source_type     text NOT NULL,
    source_id       text NOT NULL,
    occurred_at     timestamptz NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notifications_type_check CHECK (
        notification_type IN ('event_reminder', 'task_due', 'daily_brief', 'project_risk', 'weekly_review')
    ),
    CONSTRAINT notifications_source_check CHECK (
        source_type IN ('event', 'task', 'project', 'review')
    )
);

CREATE INDEX notifications_user_occurred_idx
    ON notifications (user_id, occurred_at DESC, id DESC);

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE 'ALTER TABLE notifications ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE notifications FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY notifications_user_isolation ON notifications '
            'USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))';
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS notifications;
