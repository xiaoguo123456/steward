-- +goose Up
-- 媒体资产。数据库只保存受控引用与元数据，二进制内容存放在对象存储。

CREATE TABLE media_assets (
    id            text PRIMARY KEY,
    user_id       text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- object_key 由服务端生成并带用户前缀，客户端不能自选。
    object_key    text        NOT NULL,
    kind          text        NOT NULL,
    content_type  text        NOT NULL,
    -- byte_size 与 content_hash 在上传完成后由服务端回查存储侧写入，
    -- 不采信客户端上报值。
    byte_size     bigint,
    content_hash  text,
    status        text        NOT NULL DEFAULT 'pending',
    error         jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    uploaded_at   timestamptz,
    deleted_at    timestamptz,
    CONSTRAINT media_assets_kind_check CHECK (kind IN ('image', 'audio')),
    CONSTRAINT media_assets_status_check
        CHECK (status IN ('pending', 'uploaded', 'failed', 'deleted'))
);

CREATE UNIQUE INDEX media_assets_object_key_key ON media_assets (object_key);
CREATE INDEX media_assets_user_status_idx ON media_assets (user_id, status, created_at DESC);
-- 同一用户下相同内容不重复建资产，支持“同一内容哈希不重复创建资产”。
CREATE INDEX media_assets_user_hash_idx
    ON media_assets (user_id, content_hash)
    WHERE content_hash IS NOT NULL AND deleted_at IS NULL;

-- capture_parts 通过 media_id 引用资产。原来只是裸文本列，这里补上外键约束。
ALTER TABLE capture_parts
    ADD CONSTRAINT capture_parts_media_fk
    FOREIGN KEY (media_id) REFERENCES media_assets (id) ON DELETE SET NULL;

-- +goose StatementBegin
DO $$
BEGIN
    EXECUTE 'ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE media_assets FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY media_assets_user_isolation ON media_assets '
            'USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))';
END
$$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE capture_parts DROP CONSTRAINT IF EXISTS capture_parts_media_fk;
DROP TABLE media_assets;
