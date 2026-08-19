-- +goose Up
-- 异步 Operation、Activity 撤销、HTTP 幂等与 AI 运行审计。

CREATE TABLE async_operations (
    id           text PRIMARY KEY,
    user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind         text        NOT NULL,
    status       text        NOT NULL DEFAULT 'queued',
    progress     integer,
    result_ref   jsonb,
    error        jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT async_operations_status_check
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX async_operations_user_idx ON async_operations (user_id, created_at DESC);

CREATE TABLE activity_batches (
    id         text PRIMARY KEY,
    user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source     text        NOT NULL,
    source_id  text,
    undoable   boolean     NOT NULL DEFAULT true,
    undone_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_batches_source_check CHECK (source IN (
        'user_form', 'capture_confirm', 'assistant_proposal', 'system'
    ))
);

CREATE INDEX activity_batches_user_idx ON activity_batches (user_id, created_at DESC);

CREATE TABLE activity_entries (
    id            text PRIMARY KEY,
    user_id       text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    batch_id      text        NOT NULL REFERENCES activity_batches (id) ON DELETE CASCADE,
    action        text        NOT NULL,
    resource_type text        NOT NULL,
    resource_id   text        NOT NULL,
    title         text        NOT NULL DEFAULT '',
    summary       text        NOT NULL DEFAULT '',
    -- 撤销所需的最小前后快照，只保存被本次变更影响的字段。
    before_state  jsonb,
    after_state   jsonb,
    position      integer     NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_entries_action_check CHECK (action IN (
        'created', 'updated', 'deleted', 'restored', 'completed', 'reopened'
    ))
);

CREATE INDEX activity_entries_batch_idx ON activity_entries (batch_id, position);
CREATE INDEX activity_entries_resource_idx
    ON activity_entries (user_id, resource_type, resource_id, created_at DESC);

-- HTTP 幂等快照。同一 (user, endpoint, key) 重放时直接返回首次响应，
-- 请求体不同则返回 IDEMPOTENCY_KEY_REUSED。
CREATE TABLE idempotency_keys (
    user_id       text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint      text        NOT NULL,
    key           text        NOT NULL,
    request_hash  bytea       NOT NULL,
    status_code   integer     NOT NULL,
    response_body jsonb       NOT NULL,
    resource_id   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    PRIMARY KEY (user_id, endpoint, key)
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- Worker 侧的任务级幂等，避免迟到重试产生第二次业务效果。
CREATE TABLE processed_jobs (
    idempotency_key text PRIMARY KEY,
    user_id         text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            text        NOT NULL,
    result_ref      jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- AI 运行审计。不记录完整 Prompt、用户原始正文、媒体或模型隐藏推理。
CREATE TABLE ai_actions (
    id                   text PRIMARY KEY,
    user_id              text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    feature              text        NOT NULL,
    run_id               text        NOT NULL,
    engine_type          text        NOT NULL,
    engine_version       text        NOT NULL DEFAULT '',
    provider             text        NOT NULL,
    model_policy         text        NOT NULL,
    provider_model       text        NOT NULL DEFAULT '',
    prompt_version       text        NOT NULL DEFAULT '',
    schema_version       text        NOT NULL DEFAULT '',
    input_refs           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    input_hash           bytea,
    output_hash          bytea,
    status               text        NOT NULL,
    error_class          text,
    input_tokens         integer     NOT NULL DEFAULT 0,
    output_tokens        integer     NOT NULL DEFAULT 0,
    estimated_cost       numeric(12, 6) NOT NULL DEFAULT 0,
    latency_ms           integer     NOT NULL DEFAULT 0,
    confirmation_outcome text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ai_actions_feature_check CHECK (feature IN (
        'capture', 'assistant', 'search', 'review', 'memory'
    )),
    CONSTRAINT ai_actions_status_check
        CHECK (status IN ('succeeded', 'failed', 'skipped'))
);

CREATE INDEX ai_actions_user_idx ON ai_actions (user_id, created_at DESC);
CREATE INDEX ai_actions_run_idx ON ai_actions (run_id);

-- +goose Down
DROP TABLE ai_actions;
DROP TABLE processed_jobs;
DROP TABLE idempotency_keys;
DROP TABLE activity_entries;
DROP TABLE activity_batches;
DROP TABLE async_operations;
