-- +goose Up
-- 审计补上「谁做的」。
--
-- 之前这张表记了动作、对象、时间、原因和结果，唯独没有操作者。
-- 回归时才发现：审计的全部意义是可追责，缺了 actor 就只剩一半。
--
-- 今天后台只有一个从环境变量配的账号，看起来「谁」没有歧义。
-- 但这恰恰是必须现在补的理由——等第二个账号加进来再补，
-- 之前所有的历史行都永远无法归属，而那时候正是最需要追责的时候。

-- 记用户名而不是某个内部 ID：用户名是这套单账号体系里的真实身份，
-- 而且**审计要留当时的事实**——以后配置里的用户名改了，
-- 历史行仍然该显示当时是谁做的。
ALTER TABLE admin.audit_logs ADD COLUMN actor_username text NOT NULL DEFAULT '';

-- 会话 ID 用来区分同一个人的两次登录。
-- 排查「这批操作是不是同一次会话里连着做的」时只有它能回答。
ALTER TABLE admin.audit_logs ADD COLUMN actor_session_id text;

COMMENT ON COLUMN admin.audit_logs.actor_username IS
    '操作者用户名。空字符串表示这条记录写在本迁移之前，当时没有记录操作者——'
    '不要把它当成「某个叫空字符串的人」，也不要事后猜一个填进去。';

CREATE INDEX admin_audit_actor_idx ON admin.audit_logs (actor_username, occurred_at DESC);

-- +goose Down
DROP INDEX IF EXISTS admin.admin_audit_actor_idx;
ALTER TABLE admin.audit_logs DROP COLUMN IF EXISTS actor_session_id;
ALTER TABLE admin.audit_logs DROP COLUMN IF EXISTS actor_username;
