-- +goose Up
-- 修复无 BYPASSRLS 的线上函数属主在匿名续期时无法锁定会话的问题。
-- 保留 FORCE RLS、函数 ACL 及整族重放撤销语义。
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION auth_rotate_refresh_token(
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
    token_user_id text;
    previous_user_id text := current_setting('app.user_id', true);
BEGIN
    -- SELECT 策略允许按高熵凭证定位用户，但 FOR UPDATE 同时要求 UPDATE 策略。
    -- 先从数据库确定所属用户，再在函数局部范围启用该用户的既有隔离策略；
    -- 正常返回前恢复调用者上下文；异常由事务回滚，不扩张角色权限。
    SELECT t.user_id INTO token_user_id
    FROM auth_refresh_tokens t
    WHERE t.token_hash = p_old_token_hash;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text;
        RETURN;
    END IF;
    PERFORM set_config('app.user_id', token_user_id, true);

    <<rotation>>
    BEGIN
        -- 设置隔离上下文后重新锁定并检查账号、撤销与有效期，避免并发重放。
        SELECT t.* INTO old_token
        FROM auth_refresh_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = p_old_token_hash
          AND u.deleted_at IS NULL
          AND u.account_status = 'active'
        FOR UPDATE OF t;

        IF NOT FOUND THEN
            RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text;
            EXIT rotation;
        END IF;

        IF old_token.revoked_at IS NOT NULL THEN
            UPDATE auth_refresh_tokens t
            SET revoked_at = COALESCE(t.revoked_at, now())
            WHERE t.user_id = old_token.user_id
              AND t.family_id = old_token.family_id;
            RETURN QUERY SELECT 'replayed'::text, old_token.user_id, old_token.family_id;
            EXIT rotation;
        END IF;

        IF old_token.expires_at < now() THEN
            UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = old_token.id;
            RETURN QUERY SELECT 'expired'::text, old_token.user_id, old_token.family_id;
            EXIT rotation;
        END IF;

        INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at, family_id)
        VALUES (p_new_token_id, old_token.user_id, p_new_token_hash,
                p_new_expires_at, old_token.family_id);

        UPDATE auth_refresh_tokens
        SET revoked_at = now(), replaced_by_token_id = p_new_token_id
        WHERE id = old_token.id;

        RETURN QUERY SELECT 'rotated'::text, old_token.user_id, old_token.family_id;
    END rotation;
    PERFORM set_config('app.user_id', COALESCE(previous_user_id, ''), true);
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION auth_rotate_refresh_token(
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
