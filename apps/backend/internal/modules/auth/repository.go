package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 登录前的查询无法使用 sqlc。
//
// 这三个查询必须调用 SECURITY DEFINER 函数：此时还没有 app.user_id，
// 而 users 与 auth_refresh_tokens 都受 FORCE ROW LEVEL SECURITY 保护。
// sqlc 不解析 RETURNS TABLE 函数的列类型，会把整行折叠成一个 record 标量，
// 因此这里用 pgx 直接实现，并把 SQL 集中在本文件内便于审计。

// UserRecord 是登录路径需要的最小用户信息。
type UserRecord struct {
	ID            string
	Phone         string
	DisplayName   string
	AvatarURL     *string
	Timezone      string
	Initialized   bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
	AccountStatus string
}

// RefreshTokenRecord 是刷新路径需要的最小令牌信息。
type RefreshTokenRecord struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
	RevokedAt *time.Time
}

const findUserByPhoneSQL = `
SELECT id, phone, display_name, avatar_url, timezone, initialized, created_at, updated_at, account_status
FROM auth_find_user_by_phone($1)`

const createUserSQL = `
SELECT id, phone, display_name, avatar_url, timezone, initialized, created_at, updated_at
FROM auth_create_user($1, $2, $3, $4)`

const findRefreshTokenSQL = `
SELECT id, user_id, expires_at, revoked_at
FROM auth_find_refresh_token($1)`

// findUserByPhone 按手机号查找未删除用户。未找到时返回 pgx.ErrNoRows。
func (s *Service) findUserByPhone(ctx context.Context, tx pgx.Tx, phone string) (UserRecord, error) {
	var u UserRecord
	err := tx.QueryRow(ctx, findUserByPhoneSQL, phone).Scan(
		&u.ID, &u.Phone, &u.DisplayName, &u.AvatarURL,
		&u.Timezone, &u.Initialized, &u.CreatedAt, &u.UpdatedAt, &u.AccountStatus)
	return u, err
}

// createUser 创建新用户。
func (s *Service) createUser(ctx context.Context, tx pgx.Tx, id, phone, displayName, timezone string) (UserRecord, error) {
	var u UserRecord
	err := tx.QueryRow(ctx, createUserSQL, id, phone, displayName, timezone).Scan(
		&u.ID, &u.Phone, &u.DisplayName, &u.AvatarURL,
		&u.Timezone, &u.Initialized, &u.CreatedAt, &u.UpdatedAt)
	u.AccountStatus = "active"
	return u, err
}

// findRefreshToken 按令牌哈希查找记录。
func (s *Service) findRefreshToken(ctx context.Context, tx pgx.Tx, hash []byte) (RefreshTokenRecord, error) {
	var t RefreshTokenRecord
	err := tx.QueryRow(ctx, findRefreshTokenSQL, hash).Scan(
		&t.ID, &t.UserID, &t.ExpiresAt, &t.RevokedAt)
	return t, err
}

// withAnonymousTx 在没有用户上下文的短事务中执行 fn。
func (s *Service) withAnonymousTx(ctx context.Context, fn func(context.Context, pgx.Tx) error) error {
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows) || database.IsNoRows(err)
}

// isUniqueViolation 判断是否撞了唯一约束。
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
