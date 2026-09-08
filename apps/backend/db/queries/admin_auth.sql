-- name: FindAdminAccountByPhone :one
SELECT * FROM admin.accounts WHERE phone = sqlc.arg(phone) FOR UPDATE;

-- name: FindAdminAccountByID :one
SELECT * FROM admin.accounts WHERE id = sqlc.arg(id);

-- name: UpdateAdminPassword :one
UPDATE admin.accounts SET password_hash = sqlc.arg(password_hash),
    credential_version = credential_version + 1, password_changed_at = now()
WHERE id = sqlc.arg(id) RETURNING *;

-- name: RevokeAccountAdminSessions :exec
UPDATE admin.sessions SET revoked_at = now() WHERE admin_id = sqlc.arg(admin_id) AND revoked_at IS NULL;

-- name: AdminCodeSendCounts :one
SELECT count(*) FILTER (WHERE created_at > now() - interval '60 seconds') AS recent,
    count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS hourly,
    count(*) AS daily
FROM admin.phone_challenges WHERE admin_id = sqlc.arg(admin_id) AND created_at > now() - interval '24 hours';

-- name: CreateAdminPhoneChallenge :exec
INSERT INTO admin.phone_challenges(id, admin_id, purpose, code_hash, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(admin_id), sqlc.arg(purpose), sqlc.arg(code_hash), sqlc.arg(expires_at));

-- name: MarkAdminPhoneChallengeSent :exec
UPDATE admin.phone_challenges SET sent_at = now() WHERE id = sqlc.arg(id);

-- name: FindAdminPhoneChallenge :one
SELECT * FROM admin.phone_challenges WHERE id = sqlc.arg(id) AND admin_id = sqlc.arg(admin_id)
    AND purpose = sqlc.arg(purpose) FOR UPDATE;

-- name: FailAdminPhoneChallengeAttempt :exec
UPDATE admin.phone_challenges SET attempts = attempts + 1 WHERE id = sqlc.arg(id);

-- name: ConsumeAdminPhoneChallenge :exec
UPDATE admin.phone_challenges SET consumed_at = now() WHERE id = sqlc.arg(id);

-- name: InvalidateAdminPhoneChallenges :exec
UPDATE admin.phone_challenges SET consumed_at = now() WHERE admin_id = sqlc.arg(admin_id)
    AND consumed_at IS NULL;

-- name: PurgeAdminPhoneChallenges :exec
DELETE FROM admin.phone_challenges WHERE created_at < now() - interval '7 days';
