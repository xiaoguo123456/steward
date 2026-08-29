-- +goose Up
-- Note 正文升级为判别联合，并增加心情日记的一对一扩展。
-- content 继续保存服务端确定性派生的纯文本投影，权威正文保存在 content_document。

ALTER TABLE notes
    ADD COLUMN note_kind text NOT NULL DEFAULT 'general',
    ADD COLUMN content_document jsonb;

UPDATE notes
SET content_document = jsonb_build_object('format', 'plain_text', 'text', content)
WHERE content_document IS NULL;

ALTER TABLE notes
    ALTER COLUMN content_document SET NOT NULL,
    ADD CONSTRAINT notes_kind_check CHECK (note_kind IN ('general', 'mood_journal')),
    ADD CONSTRAINT notes_content_format_check
        CHECK (content_document->>'format' IN ('plain_text', 'blocks_v1')),
    ADD CONSTRAINT notes_kind_content_check
        CHECK ((note_kind = 'general' AND content_document->>'format' = 'plain_text')
            OR (note_kind = 'mood_journal' AND content_document->>'format' = 'blocks_v1'));

CREATE INDEX notes_user_kind_updated_idx
    ON notes (user_id, note_kind, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE mood_journal_entries (
    note_id               text PRIMARY KEY REFERENCES notes (id) ON DELETE CASCADE,
    user_id               text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    occurred_at           timestamptz NOT NULL,
    mood_level            text,
    energy_level          text,
    emotion_words         text[]      NOT NULL DEFAULT '{}',
    context_words         text[]      NOT NULL DEFAULT '{}',
    exclude_from_ai       boolean     NOT NULL DEFAULT false,
    include_in_memories   boolean     NOT NULL DEFAULT true,
    visual_seed           integer     NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    version               integer     NOT NULL DEFAULT 1,
    CONSTRAINT mood_journal_mood_check
        CHECK (mood_level IS NULL OR mood_level IN ('very_low', 'low', 'neutral', 'good', 'very_good')),
    CONSTRAINT mood_journal_energy_check
        CHECK (energy_level IS NULL OR energy_level IN ('low', 'medium', 'high')),
    CONSTRAINT mood_journal_emotion_words_check CHECK (cardinality(emotion_words) <= 3),
    CONSTRAINT mood_journal_context_words_check CHECK (cardinality(context_words) <= 5),
    CONSTRAINT mood_journal_visual_seed_check CHECK (visual_seed >= 0)
);

CREATE INDEX mood_journal_user_occurred_idx
    ON mood_journal_entries (user_id, occurred_at DESC, note_id DESC);

ALTER TABLE mood_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mood_journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY mood_journal_entries_user_isolation ON mood_journal_entries
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY IF EXISTS mood_journal_entries_user_isolation ON mood_journal_entries;
DROP TABLE mood_journal_entries;
DROP INDEX notes_user_kind_updated_idx;
ALTER TABLE notes
    DROP CONSTRAINT notes_kind_content_check,
    DROP CONSTRAINT notes_content_format_check,
    DROP CONSTRAINT notes_kind_check,
    DROP COLUMN content_document,
    DROP COLUMN note_kind;
