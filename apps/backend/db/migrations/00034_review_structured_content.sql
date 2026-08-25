-- +goose Up
-- 复盘正文保持短文本，标题和重点单独存储，客户端不解析 Markdown 或 HTML。
ALTER TABLE review_snapshots
    ADD COLUMN headline text,
    ADD COLUMN highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE review_snapshots
    DROP COLUMN highlights,
    DROP COLUMN headline;
