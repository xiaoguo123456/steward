-- +goose Up
-- TaskList、Task、Event、Project、Note 与 Relation。
-- 所有实体使用应用生成的带前缀文本 ID，软删除统一用 deleted_at，
-- 并发控制统一用单调递增的 version。

CREATE TABLE projects (
    id                     text PRIMARY KEY,
    user_id                text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title                  text        NOT NULL,
    description            text,
    status                 text        NOT NULL DEFAULT 'active',
    status_before_archived text,
    start_date             date,
    target_date            date,
    created_by             text        NOT NULL DEFAULT 'user',
    provenance_refs        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    deleted_at             timestamptz,
    version                integer     NOT NULL DEFAULT 1,
    CONSTRAINT projects_status_check
        CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    CONSTRAINT projects_created_by_check
        CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX projects_user_status_idx
    ON projects (user_id, status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE task_lists (
    id          text PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        text        NOT NULL,
    color       text,
    icon        text,
    position    integer     NOT NULL DEFAULT 0,
    is_default  boolean     NOT NULL DEFAULT false,
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    version     integer     NOT NULL DEFAULT 1
);

-- 同一用户下未归档清单不可重名。
CREATE UNIQUE INDEX task_lists_user_name_key
    ON task_lists (user_id, name) WHERE archived_at IS NULL AND deleted_at IS NULL;
-- 每个用户恰好一个默认清单。
CREATE UNIQUE INDEX task_lists_user_default_key
    ON task_lists (user_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX task_lists_user_position_idx
    ON task_lists (user_id, position, id) WHERE deleted_at IS NULL;

CREATE TABLE tasks (
    id                 text PRIMARY KEY,
    user_id            text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title              text        NOT NULL,
    description        text,
    status             text        NOT NULL DEFAULT 'todo',
    priority           text        NOT NULL DEFAULT 'normal',
    due_date           date,
    due_at             timestamptz,
    due_timezone       text,
    scheduled_start_at timestamptz,
    scheduled_end_at   timestamptz,
    scheduled_timezone text,
    estimated_minutes  integer,
    focus_date         date,
    list_id            text        NOT NULL REFERENCES task_lists (id),
    project_id         text        REFERENCES projects (id) ON DELETE SET NULL,
    reminders          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    completed_at       timestamptz,
    created_by         text        NOT NULL DEFAULT 'user',
    provenance_refs    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    version            integer     NOT NULL DEFAULT 1,
    CONSTRAINT tasks_status_check
        CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
    CONSTRAINT tasks_priority_check
        CHECK (priority IN ('low', 'normal', 'high')),
    CONSTRAINT tasks_created_by_check
        CHECK (created_by IN ('user', 'ai', 'system')),
    -- due_date 与 due_at 互斥。
    CONSTRAINT tasks_due_exclusive_check
        CHECK (due_date IS NULL OR due_at IS NULL),
    -- 设置任一截止字段时必须保存所属时区。
    CONSTRAINT tasks_due_timezone_check
        CHECK ((due_date IS NULL AND due_at IS NULL) OR due_timezone IS NOT NULL),
    -- 计划时间成对出现且结束必须晚于开始。
    CONSTRAINT tasks_scheduled_pair_check
        CHECK (scheduled_end_at IS NULL
               OR (scheduled_start_at IS NOT NULL AND scheduled_end_at > scheduled_start_at)),
    CONSTRAINT tasks_estimated_minutes_check
        CHECK (estimated_minutes IS NULL OR estimated_minutes > 0)
);

CREATE INDEX tasks_user_status_idx
    ON tasks (user_id, status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX tasks_user_list_idx
    ON tasks (user_id, list_id, status) WHERE deleted_at IS NULL;
CREATE INDEX tasks_user_project_idx
    ON tasks (user_id, project_id) WHERE deleted_at IS NULL AND project_id IS NOT NULL;
-- Today 收录用到的三个日期维度。
CREATE INDEX tasks_user_due_date_idx
    ON tasks (user_id, due_date) WHERE deleted_at IS NULL AND due_date IS NOT NULL;
CREATE INDEX tasks_user_due_at_idx
    ON tasks (user_id, due_at) WHERE deleted_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX tasks_user_focus_date_idx
    ON tasks (user_id, focus_date) WHERE deleted_at IS NULL AND focus_date IS NOT NULL;
CREATE INDEX tasks_user_scheduled_idx
    ON tasks (user_id, scheduled_start_at) WHERE deleted_at IS NULL AND scheduled_start_at IS NOT NULL;
-- 中文标题按三元组做模糊匹配；Postgres 默认分词器不切分中文，
-- 直接用 to_tsvector 会把整句当成一个词，无法命中子串。
CREATE INDEX tasks_title_trgm_idx ON tasks USING gin (title gin_trgm_ops);

CREATE TABLE events (
    id                 text PRIMARY KEY,
    user_id            text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title              text        NOT NULL,
    event_kind         text        NOT NULL DEFAULT 'schedule',
    all_day            boolean     NOT NULL DEFAULT false,
    start_at           timestamptz,
    end_at             timestamptz,
    start_date         date,
    end_date           date,
    timezone           text        NOT NULL,
    location           text,
    participants       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    project_id         text        REFERENCES projects (id) ON DELETE SET NULL,
    note               text,
    reminders          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    recurrence         text        NOT NULL DEFAULT 'none',
    original_month_day text,
    created_by         text        NOT NULL DEFAULT 'user',
    provenance_refs    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    version            integer     NOT NULL DEFAULT 1,
    CONSTRAINT events_kind_check
        CHECK (event_kind IN ('schedule', 'important_date')),
    CONSTRAINT events_recurrence_check
        CHECK (recurrence IN ('none', 'yearly')),
    -- 只有 important_date 可以按年重复。
    CONSTRAINT events_recurrence_kind_check
        CHECK (recurrence = 'none' OR event_kind = 'important_date'),
    CONSTRAINT events_created_by_check
        CHECK (created_by IN ('user', 'ai', 'system')),
    -- 定时与全天两组字段互斥，且各自必填其开始值。
    CONSTRAINT events_timing_check
        CHECK (
            (all_day = false AND start_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
            OR (all_day = true AND start_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL)
        ),
    CONSTRAINT events_timed_range_check
        CHECK (end_at IS NULL OR end_at > start_at),
    CONSTRAINT events_allday_range_check
        CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX events_user_start_at_idx
    ON events (user_id, start_at) WHERE deleted_at IS NULL AND start_at IS NOT NULL;
CREATE INDEX events_user_start_date_idx
    ON events (user_id, start_date) WHERE deleted_at IS NULL AND start_date IS NOT NULL;
CREATE INDEX events_user_kind_idx
    ON events (user_id, event_kind) WHERE deleted_at IS NULL;
CREATE INDEX events_title_trgm_idx ON events USING gin (title gin_trgm_ops);

CREATE TABLE notes (
    id              text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           text        NOT NULL,
    content         text        NOT NULL,
    attachments     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    tags            text[]      NOT NULL DEFAULT '{}',
    pinned_at       timestamptz,
    project_id      text        REFERENCES projects (id) ON DELETE SET NULL,
    created_by      text        NOT NULL DEFAULT 'user',
    provenance_refs jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    version         integer     NOT NULL DEFAULT 1,
    CONSTRAINT notes_created_by_check
        CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX notes_user_updated_idx
    ON notes (user_id, pinned_at DESC NULLS LAST, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX notes_user_tags_idx ON notes USING gin (tags) WHERE deleted_at IS NULL;
CREATE INDEX notes_title_trgm_idx ON notes USING gin (title gin_trgm_ops);
CREATE INDEX notes_content_trgm_idx ON notes USING gin (content gin_trgm_ops);

CREATE TABLE relations (
    id              text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            text        NOT NULL,
    from_type       text        NOT NULL,
    from_id         text        NOT NULL,
    to_type         text        NOT NULL,
    to_id           text        NOT NULL,
    created_by      text        NOT NULL DEFAULT 'user',
    provenance_refs jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT relations_kind_check CHECK (kind IN ('requires', 'related_to')),
    CONSTRAINT relations_created_by_check CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX relations_user_from_idx
    ON relations (user_id, from_type, from_id) WHERE deleted_at IS NULL;
CREATE INDEX relations_user_to_idx
    ON relations (user_id, to_type, to_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE relations;
DROP TABLE notes;
DROP TABLE events;
DROP TABLE tasks;
DROP TABLE task_lists;
DROP TABLE projects;
