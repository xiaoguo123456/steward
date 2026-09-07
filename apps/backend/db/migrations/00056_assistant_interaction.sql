-- +goose Up
-- 澄清与结果属于权威消息状态，不放在可丢弃的 Provider 缓存中。
ALTER TABLE assistant_messages ADD COLUMN interaction jsonb;

-- +goose Down
ALTER TABLE assistant_messages DROP COLUMN interaction;
