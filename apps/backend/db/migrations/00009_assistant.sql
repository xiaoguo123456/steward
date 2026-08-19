-- +goose Up
-- Assistant 对话、Action Proposal、Review 快照与长期记忆。
--
-- 三条贯穿性的规则体现在表结构里：
--   1. 系统权威会话是自己的表，Provider 状态只是可丢弃的优化列。
--   2. 模型只产 Proposal，正式写入由确认事务执行并留下 Activity 关联。
--   3. 记忆有类型、版本、来源、敏感级别与状态，删除后可验证清理。

-- ---- Assistant ----

CREATE TABLE assistant_threads (
    id               text PRIMARY KEY,
    user_id          text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title            text        NOT NULL DEFAULT '',
    status           text        NOT NULL DEFAULT 'active',
    last_message_seq integer     NOT NULL DEFAULT 0,
    last_turn_seq    integer     NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    archived_at      timestamptz,
    deleted_at       timestamptz,
    version          integer     NOT NULL DEFAULT 1,
    CONSTRAINT assistant_threads_status_check
        CHECK (status IN ('active', 'archived', 'deleted'))
);

CREATE INDEX assistant_threads_user_idx
    ON assistant_threads (user_id, status, updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE assistant_messages (
    id                  text PRIMARY KEY,
    user_id             text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    thread_id           text        NOT NULL REFERENCES assistant_threads (id) ON DELETE CASCADE,
    message_seq         integer     NOT NULL,
    role                text        NOT NULL,
    -- content 是受控 Content Block，不保存 Provider 原始响应对象，
    -- 也不保存模型的隐藏思维过程。
    content             text        NOT NULL DEFAULT '',
    status              text        NOT NULL DEFAULT 'completed',
    turn_id             text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    deleted_at          timestamptz,
    CONSTRAINT assistant_messages_role_check
        CHECK (role IN ('user', 'assistant', 'system_summary')),
    CONSTRAINT assistant_messages_status_check
        CHECK (status IN ('draft', 'completed', 'failed', 'superseded'))
);

-- 消息在 Thread 内严格有序，序号不重复也不回退。
CREATE UNIQUE INDEX assistant_messages_seq_key
    ON assistant_messages (thread_id, message_seq);

CREATE TABLE assistant_turns (
    id                   text PRIMARY KEY,
    user_id              text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    thread_id            text        NOT NULL REFERENCES assistant_threads (id) ON DELETE CASCADE,
    turn_seq             integer     NOT NULL,
    user_message_id      text,
    assistant_message_id text,
    operation_id         text,
    status               text        NOT NULL DEFAULT 'queued',
    mode                 text,
    engine_type          text        NOT NULL DEFAULT 'direct',
    engine_version       text        NOT NULL DEFAULT '',
    model_policy         text        NOT NULL DEFAULT '',
    -- provider_state 只是可丢弃的重放优化，不参与业务唯一性与授权判断。
    provider_state       jsonb,
    error_code           text,
    started_at           timestamptz,
    completed_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    version              integer     NOT NULL DEFAULT 1,
    CONSTRAINT assistant_turns_status_check CHECK (status IN (
        'queued', 'running', 'succeeded',
        'failed_retryable', 'failed_permanent', 'cancelled', 'superseded'
    )),
    CONSTRAINT assistant_turns_mode_check
        CHECK (mode IS NULL OR mode IN ('conversation', 'query', 'capture', 'mutation'))
);

CREATE UNIQUE INDEX assistant_turns_seq_key ON assistant_turns (thread_id, turn_seq);
CREATE INDEX assistant_turns_user_status_idx ON assistant_turns (user_id, status, created_at DESC);

CREATE TABLE ai_tool_calls (
    id                text PRIMARY KEY,
    user_id           text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    turn_id           text        NOT NULL REFERENCES assistant_turns (id) ON DELETE CASCADE,
    call_seq          integer     NOT NULL,
    capability_name   text        NOT NULL,
    capability_version text       NOT NULL DEFAULT 'v1',
    risk              text        NOT NULL,
    -- 默认不保存包含用户正文的完整参数与结果，只保留哈希与摘要。
    arguments_hash    bytea,
    result_hash       bytea,
    result_summary    jsonb,
    source_refs       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    status            text        NOT NULL,
    error_code        text,
    duration_ms       integer     NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- denied 表示这次请求没有落到任何已登记能力上，因此没有风险级别可填。
    CONSTRAINT ai_tool_calls_risk_check CHECK (risk IN ('read_only', 'proposal', 'denied')),
    CONSTRAINT ai_tool_calls_status_check
        CHECK (status IN ('succeeded', 'failed', 'denied'))
);

CREATE UNIQUE INDEX ai_tool_calls_seq_key ON ai_tool_calls (turn_id, call_seq);

-- ---- Action Proposal ----

CREATE TABLE action_proposals (
    id                      text PRIMARY KEY,
    user_id                 text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    thread_id               text        REFERENCES assistant_threads (id) ON DELETE SET NULL,
    turn_id                 text        REFERENCES assistant_turns (id) ON DELETE SET NULL,
    proposal_type           text        NOT NULL,
    proposal_schema_version text        NOT NULL DEFAULT 'v1',
    target_type             text,
    target_id               text,
    target_expected_version integer,
    -- command 与 preview 是受版本化 Schema 约束的判别联合快照。
    -- 核心状态放关系列，不用 JSONB 查询代替目标、状态与过期索引。
    command                 jsonb       NOT NULL,
    preview                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
    reason                  text        NOT NULL DEFAULT '',
    source_refs             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    status                  text        NOT NULL DEFAULT 'pending',
    expires_at              timestamptz NOT NULL,
    executed_batch_id       text        REFERENCES activity_batches (id) ON DELETE SET NULL,
    error_code              text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    version                 integer     NOT NULL DEFAULT 1,
    CONSTRAINT action_proposals_status_check CHECK (status IN (
        'pending', 'executed', 'rejected', 'expired', 'stale', 'superseded', 'failed'
    )),
    CONSTRAINT action_proposals_type_check CHECK (proposal_type IN (
        'task_create', 'task_update', 'event_create', 'memory_upsert'
    ))
);

CREATE INDEX action_proposals_user_status_idx
    ON action_proposals (user_id, status, created_at DESC);
CREATE INDEX action_proposals_target_idx
    ON action_proposals (user_id, target_type, target_id, status);
-- 只为待确认项建过期索引，扫描到期建议时不用遍历全表。
CREATE INDEX action_proposals_expiry_idx
    ON action_proposals (expires_at) WHERE status = 'pending';

-- ---- Review 快照 ----

CREATE TABLE review_snapshots (
    id             text PRIMARY KEY,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    period_kind    text        NOT NULL DEFAULT 'weekly',
    period_start   date        NOT NULL,
    period_end     date        NOT NULL,
    -- metrics 由 SQL 确定性计算，narrative 与 suggestions 是可选的 AI 增强。
    metrics        jsonb       NOT NULL,
    narrative      text,
    suggestions    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    sources        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    generated_by   text        NOT NULL DEFAULT 'system',
    prompt_version text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    generated_at   timestamptz,
    CONSTRAINT review_snapshots_generated_by_check
        CHECK (generated_by IN ('system', 'ai'))
);

CREATE UNIQUE INDEX review_snapshots_period_key
    ON review_snapshots (user_id, period_kind, period_start);

-- ---- 长期记忆 ----

CREATE TABLE memory_items (
    id                   text PRIMARY KEY,
    user_id              text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- memory_key 是稳定语义键，例如 communication.response_style，
    -- 不是模型随意生成的标题。
    memory_key           text        NOT NULL,
    memory_type          text        NOT NULL,
    value_schema_version text        NOT NULL DEFAULT 'v1',
    value                jsonb       NOT NULL,
    -- canonical_text 只用于展示与检索，不替代 value。
    canonical_text       text        NOT NULL,
    sensitivity          text        NOT NULL DEFAULT 'normal',
    origin               text        NOT NULL DEFAULT 'learned',
    status               text        NOT NULL DEFAULT 'active',
    valid_from           timestamptz,
    valid_until          timestamptz,
    confirmed_at         timestamptz,
    last_used_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    version              integer     NOT NULL DEFAULT 1,
    CONSTRAINT memory_items_type_check CHECK (memory_type IN (
        'communication_preference', 'routine_preference',
        'domain_preference', 'personal_context', 'constraint'
    )),
    CONSTRAINT memory_items_sensitivity_check
        CHECK (sensitivity IN ('normal', 'sensitive', 'highly_sensitive')),
    CONSTRAINT memory_items_origin_check
        CHECK (origin IN ('explicit', 'learned', 'imported')),
    CONSTRAINT memory_items_status_check
        CHECK (status IN ('active', 'superseded', 'deleted', 'expired', 'shadowed'))
);

-- 同一语义键下只能有一条生效记忆。
CREATE UNIQUE INDEX memory_items_active_key
    ON memory_items (user_id, memory_key) WHERE status = 'active';
CREATE INDEX memory_items_user_status_idx
    ON memory_items (user_id, status, updated_at DESC);
CREATE INDEX memory_items_text_trgm_idx
    ON memory_items USING gin (canonical_text gin_trgm_ops);

CREATE TABLE memory_revisions (
    id             text PRIMARY KEY,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    memory_id      text        NOT NULL REFERENCES memory_items (id) ON DELETE CASCADE,
    revision       integer     NOT NULL,
    value          jsonb,
    canonical_text text,
    change_kind    text        NOT NULL,
    changed_by     text        NOT NULL,
    proposal_id    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memory_revisions_change_kind_check CHECK (change_kind IN (
        'create', 'edit', 'supersede', 'delete', 'restore'
    )),
    CONSTRAINT memory_revisions_changed_by_check
        CHECK (changed_by IN ('user', 'assistant_proposal', 'system'))
);

CREATE UNIQUE INDEX memory_revisions_key ON memory_revisions (memory_id, revision);

CREATE TABLE memory_evidence (
    id             text PRIMARY KEY,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    memory_id      text        NOT NULL REFERENCES memory_items (id) ON DELETE CASCADE,
    memory_version integer     NOT NULL,
    source_type    text        NOT NULL,
    source_id      text        NOT NULL,
    source_version integer,
    locator        jsonb,
    evidence_role  text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    CONSTRAINT memory_evidence_role_check
        CHECK (evidence_role IN ('explicit', 'inferred', 'user_confirmed'))
);

CREATE INDEX memory_evidence_memory_idx ON memory_evidence (memory_id, created_at);

CREATE TABLE memory_relearn_blocks (
    id                     text PRIMARY KEY,
    user_id                text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    memory_key             text        NOT NULL,
    -- value_fingerprint 基于类型化规范值计算，不是用户原句的哈希：
    -- 否则换一种说法就能绕过阻止。这里不保存任何明文。
    value_fingerprint      bytea       NOT NULL,
    fingerprint_key_version text       NOT NULL DEFAULT 'v1',
    blocked_at             timestamptz NOT NULL DEFAULT now(),
    expires_at             timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_relearn_blocks_key
    ON memory_relearn_blocks (user_id, memory_key, value_fingerprint);

-- ---- 行级安全 ----

-- +goose StatementBegin
DO $$
DECLARE
    t text;
    scoped_tables text[] := ARRAY[
        'assistant_threads', 'assistant_messages', 'assistant_turns', 'ai_tool_calls',
        'action_proposals', 'review_snapshots',
        'memory_items', 'memory_revisions', 'memory_evidence', 'memory_relearn_blocks'
    ];
BEGIN
    FOREACH t IN ARRAY scoped_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))',
            t || '_user_isolation', t);
    END LOOP;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE memory_relearn_blocks;
DROP TABLE memory_evidence;
DROP TABLE memory_revisions;
DROP TABLE memory_items;
DROP TABLE review_snapshots;
DROP TABLE action_proposals;
DROP TABLE ai_tool_calls;
DROP TABLE assistant_turns;
DROP TABLE assistant_messages;
DROP TABLE assistant_threads;
