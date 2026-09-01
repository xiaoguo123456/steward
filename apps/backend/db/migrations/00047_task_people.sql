-- +goose Up
-- Task 继续归属 TaskList；task_people 只表达任务与亲友的额外关联。

ALTER TABLE tasks
    ADD CONSTRAINT tasks_identity_key UNIQUE (id, user_id);

CREATE TABLE task_people (
    task_id    text        NOT NULL,
    person_id  text        NOT NULL,
    user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, person_id),
    CONSTRAINT task_people_task_fk
        FOREIGN KEY (task_id, user_id)
        REFERENCES tasks (id, user_id) ON DELETE CASCADE,
    CONSTRAINT task_people_person_fk
        FOREIGN KEY (person_id, user_id)
        REFERENCES people (id, user_id) ON DELETE CASCADE
);

CREATE INDEX task_people_person_idx
    ON task_people (user_id, person_id, task_id);

ALTER TABLE task_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_people FORCE ROW LEVEL SECURITY;
CREATE POLICY task_people_user_isolation ON task_people
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY IF EXISTS task_people_user_isolation ON task_people;
DROP TABLE task_people;
ALTER TABLE tasks DROP CONSTRAINT tasks_identity_key;
