-- +goose Up
-- 亲友档案只保存用户主动录入的信息；系统联系人导入不属于本次迁移范围。
-- 未来事件继续复用 events，历史联系记录由 person_interactions 单独承载。

ALTER TABLE events
    ADD CONSTRAINT events_identity_key UNIQUE (id, user_id);

CREATE TABLE people (
    id                 text PRIMARY KEY,
    user_id            text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               text        NOT NULL,
    relationship_group text        NOT NULL DEFAULT 'other',
    relationship_label text,
    note               text,
    created_by         text        NOT NULL DEFAULT 'user',
    provenance_refs    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    version            integer     NOT NULL DEFAULT 1,
    CONSTRAINT people_identity_key UNIQUE (id, user_id),
    CONSTRAINT people_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT people_group_check
        CHECK (relationship_group IN ('family', 'friend', 'colleague', 'other')),
    CONSTRAINT people_label_length
        CHECK (relationship_label IS NULL OR char_length(relationship_label) <= 40),
    CONSTRAINT people_note_length CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT people_created_by_check CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX people_user_name_idx
    ON people (user_id, name, id) WHERE deleted_at IS NULL;
CREATE INDEX people_name_trgm_idx
    ON people USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;

CREATE TABLE person_interactions (
    id               text PRIMARY KEY,
    user_id          text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    person_id        text        NOT NULL,
    interaction_type text        NOT NULL,
    occurred_at      timestamptz NOT NULL,
    summary          text        NOT NULL,
    note             text,
    created_by       text        NOT NULL DEFAULT 'user',
    provenance_refs  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    version          integer     NOT NULL DEFAULT 1,
    CONSTRAINT person_interactions_person_fk
        FOREIGN KEY (person_id, user_id)
        REFERENCES people (id, user_id) ON DELETE CASCADE,
    CONSTRAINT person_interactions_type_check
        CHECK (interaction_type IN ('met', 'call', 'message', 'meal', 'gift', 'other')),
    CONSTRAINT person_interactions_summary_length
        CHECK (char_length(summary) BETWEEN 1 AND 160),
    CONSTRAINT person_interactions_note_length
        CHECK (note IS NULL OR char_length(note) <= 1000),
    CONSTRAINT person_interactions_created_by_check
        CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX person_interactions_person_occurred_idx
    ON person_interactions (user_id, person_id, occurred_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE event_people (
    event_id  text        NOT NULL,
    person_id text        NOT NULL,
    user_id   text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, person_id),
    CONSTRAINT event_people_event_fk
        FOREIGN KEY (event_id, user_id)
        REFERENCES events (id, user_id) ON DELETE CASCADE,
    CONSTRAINT event_people_person_fk
        FOREIGN KEY (person_id, user_id)
        REFERENCES people (id, user_id) ON DELETE CASCADE
);

CREATE INDEX event_people_person_idx ON event_people (user_id, person_id, event_id);

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_user_isolation ON people
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE person_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY person_interactions_user_isolation ON person_interactions
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE event_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_people FORCE ROW LEVEL SECURITY;
CREATE POLICY event_people_user_isolation ON event_people
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY IF EXISTS event_people_user_isolation ON event_people;
DROP POLICY IF EXISTS person_interactions_user_isolation ON person_interactions;
DROP POLICY IF EXISTS people_user_isolation ON people;
DROP TABLE event_people;
DROP TABLE person_interactions;
DROP TABLE people;
ALTER TABLE events DROP CONSTRAINT events_identity_key;
