-- +goose Up
-- Tracker 是可复用的字段定义，Record 是某次实际记录。
-- Tracker 不是 Object，也不作为 Relation 端点。

CREATE TABLE trackers (
    id              text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    description     text,
    fields          jsonb       NOT NULL,
    status          text        NOT NULL DEFAULT 'active',
    color           text,
    icon            text,
    created_by      text        NOT NULL DEFAULT 'user',
    provenance_refs jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    version         integer     NOT NULL DEFAULT 1,
    CONSTRAINT trackers_status_check CHECK (status IN ('active', 'archived')),
    CONSTRAINT trackers_created_by_check CHECK (created_by IN ('user', 'ai', 'system')),
    -- fields 必须是非空数组；单个字段的结构由 Go Domain 校验。
    CONSTRAINT trackers_fields_check
        CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) > 0)
);

CREATE INDEX trackers_user_status_idx
    ON trackers (user_id, status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE records (
    id              text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           text        NOT NULL,
    tracker_id      text        NOT NULL REFERENCES trackers (id),
    timestamp       timestamptz NOT NULL,
    values          jsonb       NOT NULL,
    note            text,
    project_id      text        REFERENCES projects (id) ON DELETE SET NULL,
    created_by      text        NOT NULL DEFAULT 'user',
    provenance_refs jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    version         integer     NOT NULL DEFAULT 1,
    CONSTRAINT records_created_by_check CHECK (created_by IN ('user', 'ai', 'system')),
    CONSTRAINT records_values_check CHECK (jsonb_typeof(values) = 'array')
);

CREATE INDEX records_user_tracker_time_idx
    ON records (user_id, tracker_id, timestamp DESC) WHERE deleted_at IS NULL;
CREATE INDEX records_user_time_idx
    ON records (user_id, timestamp DESC) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE records;
DROP TABLE trackers;
