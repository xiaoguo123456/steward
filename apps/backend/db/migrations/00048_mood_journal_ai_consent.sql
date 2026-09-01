-- +goose Up
-- 心情日记正文属于高敏用户内容；只有用户单独开启后才允许发送给 AI Provider。

ALTER TABLE user_ai_settings
    ADD COLUMN mood_journal_ai_enabled boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE user_ai_settings
    DROP COLUMN mood_journal_ai_enabled;
