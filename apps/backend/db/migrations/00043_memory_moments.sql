-- +goose Up
-- 时光是用户主动发布的私人照片记录，与 AI 长期记忆 memory_items 完全分离。
-- 发布后没有更新状态机；业务层只允许整段软删除，并同步清理引用的媒体副本。

CREATE TABLE memory_moments (
    id          text PRIMARY KEY,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    occurred_on date        NOT NULL,
    title       text        NOT NULL DEFAULT '',
    story       text        NOT NULL DEFAULT '',
    created_by  text        NOT NULL DEFAULT 'user',
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT memory_moments_identity_key UNIQUE (id, user_id),
    CONSTRAINT memory_moments_title_length CHECK (char_length(title) <= 32),
    CONSTRAINT memory_moments_story_length CHECK (char_length(story) <= 300),
    CONSTRAINT memory_moments_created_by_check CHECK (created_by IN ('user', 'ai', 'system'))
);

CREATE INDEX memory_moments_user_occurred_idx
    ON memory_moments (user_id, occurred_on DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE memory_moment_photos (
    moment_id   text        NOT NULL,
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_id    text        NOT NULL REFERENCES media_assets (id),
    position    integer     NOT NULL,
    description text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (moment_id, position),
    CONSTRAINT memory_moment_photos_media_unique UNIQUE (media_id),
    CONSTRAINT memory_moment_photos_moment_fk
        FOREIGN KEY (moment_id, user_id)
        REFERENCES memory_moments (id, user_id) ON DELETE CASCADE,
    CONSTRAINT memory_moment_photos_position_check CHECK (position BETWEEN 0 AND 8),
    CONSTRAINT memory_moment_photos_description_length CHECK (char_length(description) <= 200)
);

CREATE INDEX memory_moment_photos_media_idx ON memory_moment_photos (media_id);

ALTER TABLE memory_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_moments FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_moments_user_isolation ON memory_moments
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE memory_moment_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_moment_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_moment_photos_user_isolation ON memory_moment_photos
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

-- +goose Down
DROP POLICY IF EXISTS memory_moment_photos_user_isolation ON memory_moment_photos;
DROP POLICY IF EXISTS memory_moments_user_isolation ON memory_moments;
DROP TABLE memory_moment_photos;
DROP TABLE memory_moments;
