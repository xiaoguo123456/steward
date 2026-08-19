-- +goose Up
-- 统一 Capture 的临时输入域。Capture、Part、Candidate 与 Question 都不是用户正式内容，
-- 只有 confirmed 事务写入的实体才能被 Today、计划、笔记、数据与搜索读取。

CREATE TABLE captures (
    id                   text PRIMARY KEY,
    user_id              text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status               text        NOT NULL DEFAULT 'draft',
    revision             integer     NOT NULL DEFAULT 1,
    origin               text        NOT NULL DEFAULT 'home',
    instruction_note     text,
    suggested_project_id text,
    timezone             text        NOT NULL,
    error                jsonb,
    activity_batch_id    text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    confirmed_at         timestamptz,
    CONSTRAINT captures_status_check CHECK (status IN (
        'draft', 'submitting', 'preprocessing', 'parsing', 'awaiting_instruction',
        'needs_confirmation', 'confirmed', 'partially_failed', 'failed',
        'discarded', 'expired'
    )),
    CONSTRAINT captures_origin_check CHECK (origin IN (
        'home', 'list', 'note', 'project_manager', 'assistant', 'tracker'
    ))
);

CREATE INDEX captures_user_status_idx ON captures (user_id, status, created_at DESC);

CREATE TABLE capture_parts (
    id          text PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    capture_id  text        NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    revision    integer     NOT NULL,
    kind        text        NOT NULL,
    status      text        NOT NULL DEFAULT 'pending',
    position    integer     NOT NULL DEFAULT 0,
    text        text,
    media_id    text,
    media_url   text,
    duration_ms integer,
    error       jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capture_parts_kind_check CHECK (kind IN ('text', 'audio', 'image')),
    CONSTRAINT capture_parts_status_check
        CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'ignored'))
);

CREATE INDEX capture_parts_capture_idx
    ON capture_parts (capture_id, revision, position);

CREATE TABLE capture_candidates (
    id                      text PRIMARY KEY,
    user_id                 text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    capture_id              text        NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    revision                integer     NOT NULL,
    candidate_type          text        NOT NULL,
    action                  text        NOT NULL DEFAULT 'create',
    target_id               text,
    target_expected_version integer,
    selected                boolean     NOT NULL DEFAULT true,
    -- 版本化判别联合快照，形状由 CaptureDraftPayload 约束。
    payload                 jsonb       NOT NULL,
    field_confidences       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    source_refs             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    missing_fields          text[]      NOT NULL DEFAULT '{}',
    warnings                text[]      NOT NULL DEFAULT '{}',
    duplicate_of            text,
    position                integer     NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capture_candidates_type_check CHECK (candidate_type IN (
        'task', 'event', 'project', 'note', 'tracker', 'record'
    )),
    CONSTRAINT capture_candidates_action_check CHECK (action IN ('create', 'update'))
);

CREATE INDEX capture_candidates_capture_idx
    ON capture_candidates (capture_id, revision, position);

CREATE TABLE capture_relation_candidates (
    id         text PRIMARY KEY,
    user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    capture_id text        NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    revision   integer     NOT NULL,
    kind       text        NOT NULL,
    from_ref   text        NOT NULL,
    to_ref     text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capture_relation_candidates_kind_check
        CHECK (kind IN ('requires', 'related_to'))
);

CREATE INDEX capture_relation_candidates_capture_idx
    ON capture_relation_candidates (capture_id, revision);

CREATE TABLE capture_questions (
    id              text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    capture_id      text        NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    revision        integer     NOT NULL,
    question        text        NOT NULL,
    blocking        boolean     NOT NULL DEFAULT false,
    status          text        NOT NULL DEFAULT 'open',
    quick_answers   text[]      NOT NULL DEFAULT '{}',
    capture_summary text        NOT NULL DEFAULT '',
    answer_text     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    answered_at     timestamptz,
    CONSTRAINT capture_questions_status_check
        CHECK (status IN ('open', 'answered', 'superseded', 'expired'))
);

CREATE INDEX capture_questions_user_status_idx
    ON capture_questions (user_id, status, created_at DESC);

CREATE TABLE capture_conflicts (
    id          text PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    capture_id  text        NOT NULL REFERENCES captures (id) ON DELETE CASCADE,
    revision    integer     NOT NULL,
    field       text        NOT NULL,
    description text        NOT NULL DEFAULT '',
    options     jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX capture_conflicts_capture_idx
    ON capture_conflicts (capture_id, revision);

-- +goose Down
DROP TABLE capture_conflicts;
DROP TABLE capture_questions;
DROP TABLE capture_relation_candidates;
DROP TABLE capture_candidates;
DROP TABLE capture_parts;
DROP TABLE captures;
