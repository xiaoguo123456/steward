-- +goose Up
-- 时光改为类似动态发布：日期取发布时间，正文统一为描述，不再维护标题与故事两套字段。

ALTER TABLE memory_moments
    DROP CONSTRAINT memory_moments_story_length;
ALTER TABLE memory_moments
    RENAME COLUMN story TO description;

UPDATE memory_moments
SET description = CASE
    WHEN title <> '' AND description <> '' THEN title || E'\n' || description
    WHEN title <> '' THEN title
    ELSE description
END;

ALTER TABLE memory_moments
    DROP CONSTRAINT memory_moments_title_length,
    DROP COLUMN title,
    ADD CONSTRAINT memory_moments_description_length
        CHECK (char_length(description) <= 500);

-- +goose Down
-- 回滚时把统一描述完整放回 story；无法可靠猜测用户原先的标题分界。

ALTER TABLE memory_moments
    DROP CONSTRAINT memory_moments_description_length;
ALTER TABLE memory_moments
    RENAME COLUMN description TO story;

ALTER TABLE memory_moments
    ADD COLUMN title text NOT NULL DEFAULT '',
    ADD CONSTRAINT memory_moments_title_length CHECK (char_length(title) <= 32),
    ADD CONSTRAINT memory_moments_story_length CHECK (char_length(story) <= 500);
