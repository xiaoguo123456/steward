-- +goose Up
-- 流式回复的草稿。
--
-- SSE 通道是 fire-and-forget：客户端在这一轮开始之后才连上来时，
-- 之前推过的增量已经没了，屏幕上会从半句话开始出现文字。
-- 这里存一份「到目前为止的完整文本」，连上来时先补一次。
--
-- 它不是权威内容：权威文本是这一轮结束后写入 assistant_messages 的那条。
-- 草稿只覆盖同一行，不为每个增量写一行。
ALTER TABLE assistant_turns ADD COLUMN draft_content text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE assistant_turns DROP COLUMN draft_content;
