-- 账户与偏好。登录链路在拿到用户身份之前只能走 SECURITY DEFINER 函数。

-- 说明：登录前的三个查询（按手机号查用户、创建用户、按哈希查 Refresh Token）
-- 必须调用 SECURITY DEFINER 函数才能在没有 app.user_id 的情况下访问受 RLS 保护的表。
-- sqlc 无法解析 RETURNS TABLE 函数的列类型，因此这三个查询由
-- internal/modules/auth/repository.go 用 pgx 直接实现，不在本文件中定义。

-- name: GetUser :one
SELECT * FROM users WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: UpdateUser :one
UPDATE users SET
    display_name = coalesce(sqlc.narg(display_name), display_name),
    avatar_url   = CASE WHEN sqlc.arg(clear_avatar)::bool THEN NULL
                        ELSE coalesce(sqlc.narg(avatar_url), avatar_url) END,
    timezone     = coalesce(sqlc.narg(timezone), timezone),
    updated_at   = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: MarkUserInitialized :exec
UPDATE users SET initialized = true, updated_at = now()
WHERE id = sqlc.arg(id);

-- name: CreateVerificationCode :one
INSERT INTO auth_verification_codes (id, phone, purpose, code_hash, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(phone), sqlc.arg(purpose), sqlc.arg(code_hash), sqlc.arg(expires_at))
RETURNING *;

-- name: GetLatestVerificationCode :one
SELECT * FROM auth_verification_codes
WHERE phone = sqlc.arg(phone) AND purpose = sqlc.arg(purpose)
ORDER BY created_at DESC
LIMIT 1;

-- name: ConsumeVerificationCode :exec
UPDATE auth_verification_codes SET consumed_at = now()
WHERE id = sqlc.arg(id);

-- name: IncrementVerificationAttempts :exec
UPDATE auth_verification_codes SET attempts = attempts + 1
WHERE id = sqlc.arg(id);

-- name: CreateRefreshToken :one
INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(token_hash), sqlc.arg(expires_at))
RETURNING *;

-- name: RevokeRefreshToken :exec
UPDATE auth_refresh_tokens SET revoked_at = now()
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: RevokeAllRefreshTokens :exec
UPDATE auth_refresh_tokens SET revoked_at = now()
WHERE user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: EnsureUserPreferences :one
INSERT INTO user_preferences (user_id)
VALUES (sqlc.arg(user_id))
ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id
RETURNING *;

-- name: GetUserPreferences :one
SELECT * FROM user_preferences WHERE user_id = sqlc.arg(user_id);

-- name: UpdateUserPreferences :one
UPDATE user_preferences SET
    week_start                  = coalesce(sqlc.narg(week_start), week_start),
    work_day_start              = coalesce(sqlc.narg(work_day_start), work_day_start),
    work_day_end                = coalesce(sqlc.narg(work_day_end), work_day_end),
    default_reminder_local_time = coalesce(sqlc.narg(default_reminder_local_time), default_reminder_local_time),
    updated_at                  = now()
WHERE user_id = sqlc.arg(user_id)
RETURNING *;

-- name: EnsureAiSettings :one
INSERT INTO user_ai_settings (user_id)
VALUES (sqlc.arg(user_id))
ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id
RETURNING *;

-- name: GetAiSettings :one
SELECT * FROM user_ai_settings WHERE user_id = sqlc.arg(user_id);

-- name: UpdateAiSettings :one
UPDATE user_ai_settings SET
    capture_parse_enabled   = coalesce(sqlc.narg(capture_parse_enabled), capture_parse_enabled),
    suggestion_enabled      = coalesce(sqlc.narg(suggestion_enabled), suggestion_enabled),
    memory_learning_enabled = coalesce(sqlc.narg(memory_learning_enabled), memory_learning_enabled),
    mood_journal_ai_enabled = coalesce(sqlc.narg(mood_journal_ai_enabled), mood_journal_ai_enabled),
    updated_at              = now()
WHERE user_id = sqlc.arg(user_id)
RETURNING *;

-- name: UpdateUserPhone :one
-- 换绑手机号。手机号是这个产品的账号标识，单独一条语句而不是塞进 UpdateUser：
-- 它需要的授权强度和改昵称完全不同（见 auth.ChangePhone）。
UPDATE users SET phone = sqlc.arg(phone), updated_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;
