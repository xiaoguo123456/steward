-- +goose Up
-- 认证会话安全闭环：Refresh Token 按 family 轮换，旧 Token 重放时撤销整族。

ALTER TABLE auth_refresh_tokens
    ADD COLUMN family_id text,
    ADD COLUMN replaced_by_token_id text;

UPDATE auth_refresh_tokens SET family_id = id WHERE family_id IS NULL;

ALTER TABLE auth_refresh_tokens
    ALTER COLUMN family_id SET NOT NULL,
    ADD CONSTRAINT auth_refresh_tokens_replaced_by_fk
        FOREIGN KEY (replaced_by_token_id) REFERENCES auth_refresh_tokens (id) ON DELETE SET NULL;

CREATE INDEX auth_refresh_tokens_family_idx
    ON auth_refresh_tokens (user_id, family_id, expires_at DESC);

-- 锁旧 Token、轮换和创建新 Token 必须处于同一数据库事务。
-- 第二个并发请求看到 revoked_at 后被识别为重放，并撤销整个 family。
-- +goose StatementBegin
CREATE FUNCTION auth_rotate_refresh_token(
    p_old_token_hash bytea,
    p_new_token_id text,
    p_new_token_hash bytea,
    p_new_expires_at timestamptz
)
RETURNS TABLE (outcome text, user_id text, family_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    old_token auth_refresh_tokens%ROWTYPE;
BEGIN
    SELECT t.* INTO old_token
    FROM auth_refresh_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = p_old_token_hash
      AND u.deleted_at IS NULL
      AND u.account_status = 'active'
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text;
        RETURN;
    END IF;

    IF old_token.revoked_at IS NOT NULL THEN
        UPDATE auth_refresh_tokens t
        SET revoked_at = COALESCE(t.revoked_at, now())
        WHERE t.user_id = old_token.user_id
          AND t.family_id = old_token.family_id;
        RETURN QUERY SELECT 'replayed'::text, old_token.user_id, old_token.family_id;
        RETURN;
    END IF;

    IF old_token.expires_at < now() THEN
        UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = old_token.id;
        RETURN QUERY SELECT 'expired'::text, old_token.user_id, old_token.family_id;
        RETURN;
    END IF;

    INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at, family_id)
    VALUES (p_new_token_id, old_token.user_id, p_new_token_hash,
            p_new_expires_at, old_token.family_id);

    UPDATE auth_refresh_tokens
    SET revoked_at = now(), replaced_by_token_id = p_new_token_id
    WHERE id = old_token.id;

    RETURN QUERY SELECT 'rotated'::text, old_token.user_id, old_token.family_id;
END;
$$;
-- +goose StatementEnd

REVOKE EXECUTE ON FUNCTION auth_rotate_refresh_token(bytea, text, bytea, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_rotate_refresh_token(bytea, text, bytea, timestamptz) TO steward_app;

-- +goose StatementBegin
DO $$
DECLARE
    app_role text;
BEGIN
    CASE current_database()
        WHEN 'steward_test' THEN app_role := 'steward_t_app';
        WHEN 'steward_prod' THEN app_role := 'steward_p_app';
        ELSE RETURN;
    END CASE;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION auth_rotate_refresh_token(bytea, text, bytea, timestamptz) TO %I',
            app_role);
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS auth_rotate_refresh_token(bytea, text, bytea, timestamptz);
DROP INDEX IF EXISTS auth_refresh_tokens_family_idx;
ALTER TABLE auth_refresh_tokens
    DROP CONSTRAINT IF EXISTS auth_refresh_tokens_replaced_by_fk,
    DROP COLUMN IF EXISTS replaced_by_token_id,
    DROP COLUMN IF EXISTS family_id;
