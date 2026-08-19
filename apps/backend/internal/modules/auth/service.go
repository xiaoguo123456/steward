// Package auth 拥有登录、令牌签发与刷新。
//
// 验证码与 Refresh Token 都只以哈希形式落库；日志、埋点与测试快照
// 不得记录明文验证码或令牌。
package auth

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

const (
	// codeTTL 是验证码有效期。
	codeTTL = 5 * time.Minute
	// resendCooldown 是两次发送之间的最小间隔。
	resendCooldown = 60 * time.Second
	// maxAttempts 是同一验证码允许的最大尝试次数，超过后必须重新获取。
	maxAttempts = 5
)

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

// UserInitializer 是 users 模块公开的初始化能力。
type UserInitializer interface {
	EnsureDefaults(ctx context.Context, q *dbgen.Queries, userID string) error
}

// Service 是登录相关的应用服务。
type Service struct {
	db     *database.DB
	tokens *auth.TokenService
	users  UserInitializer
	// devCode 非空时跳过真实短信通道，固定使用该验证码，仅用于开发环境。
	devCode string
}

// New 构造 Service。
func New(db *database.DB, tokens *auth.TokenService, users UserInitializer, devCode string) *Service {
	return &Service{db: db, tokens: tokens, users: users, devCode: devCode}
}

// CodeResult 是发送验证码的结果。
type CodeResult struct {
	ExpiresInSeconds   int
	ResendAfterSeconds int
	// DevCode 只在开发环境返回，生产环境恒为空。
	DevCode string
}

// RequestCode 发送登录验证码。
func (s *Service) RequestCode(ctx context.Context, phone, purpose string) (CodeResult, error) {
	phone = strings.TrimSpace(phone)
	if !phonePattern.MatchString(phone) {
		return CodeResult{}, apperr.New(apperr.CodePhoneInvalid)
	}
	if purpose == "" {
		purpose = "login"
	}

	code := s.devCode
	if code == "" {
		generated, err := auth.GenerateNumericCode(6)
		if err != nil {
			return CodeResult{}, apperr.Internal(err)
		}
		code = generated
	}

	now := time.Now()
	var result CodeResult
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		// 冷却期内重复请求直接拒绝，避免被用来轰炸短信。
		latest, err := q.GetLatestVerificationCode(ctx, dbgen.GetLatestVerificationCodeParams{
			Phone: phone, Purpose: purpose,
		})
		if err == nil && now.Sub(latest.CreatedAt) < resendCooldown {
			return apperr.Newf(apperr.CodeRateLimited, "请求过于频繁，请 %d 秒后重试。",
				int((resendCooldown-now.Sub(latest.CreatedAt)).Seconds())+1)
		}
		if err != nil && !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		if _, err := q.CreateVerificationCode(ctx, dbgen.CreateVerificationCodeParams{
			ID:        idgen.New(idgen.PrefixVerificationCode),
			Phone:     phone,
			Purpose:   purpose,
			CodeHash:  auth.HashToken(code),
			ExpiresAt: now.Add(codeTTL),
		}); err != nil {
			return apperr.Internal(err)
		}

		result = CodeResult{
			ExpiresInSeconds:   int(codeTTL.Seconds()),
			ResendAfterSeconds: int(resendCooldown.Seconds()),
			DevCode:            s.devCode,
		}
		return nil
	})
	return result, err
}

// LoginResult 是登录成功的结果。
type LoginResult struct {
	AccessToken      string
	AccessExpiresAt  time.Time
	RefreshToken     string
	RefreshExpiresAt time.Time
	User             dbgen.User
	IsNewUser        bool
}

// Login 校验验证码并签发令牌。首次登录时同时完成用户初始化。
func (s *Service) Login(ctx context.Context, phone, code, timezone string) (LoginResult, error) {
	phone = strings.TrimSpace(phone)
	if !phonePattern.MatchString(phone) {
		return LoginResult{}, apperr.New(apperr.CodePhoneInvalid)
	}
	if timezone == "" {
		timezone = timeutil.DefaultTimezone
	}

	now := time.Now()
	var result LoginResult

	// 第一步：在匿名事务中校验验证码并确保用户存在。
	// 用户创建必须走 SECURITY DEFINER 函数，因为此时还没有 app.user_id。
	var userID string
	err := s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		q := dbgen.New(tx)
		record, err := q.GetLatestVerificationCode(ctx, dbgen.GetLatestVerificationCodeParams{
			Phone: phone, Purpose: "login",
		})
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeCodeInvalid)
			}
			return apperr.Internal(err)
		}
		if record.ConsumedAt != nil {
			return apperr.New(apperr.CodeCodeInvalid)
		}
		if now.After(record.ExpiresAt) {
			return apperr.New(apperr.CodeCodeExpired)
		}
		if record.Attempts >= maxAttempts {
			return apperr.Newf(apperr.CodeCodeInvalid, "验证码尝试次数过多，请重新获取。")
		}
		if !auth.CompareCode(record.CodeHash, code) {
			// 失败也要记数，避免被暴力枚举。
			if err := q.IncrementVerificationAttempts(ctx, record.ID); err != nil {
				return apperr.Internal(err)
			}
			return apperr.New(apperr.CodeCodeInvalid)
		}
		if err := q.ConsumeVerificationCode(ctx, record.ID); err != nil {
			return apperr.Internal(err)
		}

		existing, err := s.findUserByPhone(ctx, tx, phone)
		switch {
		case err == nil:
			userID = existing.ID
			result.User = toUserRow(existing)
		case isNoRows(err):
			created, err := s.createUser(ctx, tx,
				idgen.New(idgen.PrefixUser), phone, defaultDisplayName(phone), timezone)
			if err != nil {
				return apperr.Internal(err)
			}
			userID = created.ID
			result.IsNewUser = true
			result.User = toUserRow(created)
		default:
			return apperr.Internal(err)
		}
		return nil
	})
	if err != nil {
		return LoginResult{}, err
	}

	// 第二步：在用户上下文中补齐默认数据并签发 Refresh Token。
	refreshPlain, refreshHash, err := auth.GenerateRefreshToken()
	if err != nil {
		return LoginResult{}, apperr.Internal(err)
	}
	refreshExpiresAt := now.Add(s.tokens.RefreshTTL())

	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := s.users.EnsureDefaults(ctx, q, userID); err != nil {
			return err
		}
		if _, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
			ID:        idgen.New(idgen.PrefixRefreshToken),
			UserID:    userID,
			TokenHash: refreshHash,
			ExpiresAt: refreshExpiresAt,
		}); err != nil {
			return apperr.Internal(err)
		}
		// 初始化后重新读取，返回 initialized=true 的最新状态。
		row, err := q.GetUser(ctx, userID)
		if err != nil {
			return apperr.Internal(err)
		}
		result.User = row
		return nil
	})
	if err != nil {
		return LoginResult{}, err
	}

	accessToken, accessExpiresAt, err := s.tokens.IssueAccessToken(userID, now)
	if err != nil {
		return LoginResult{}, apperr.Internal(err)
	}

	result.AccessToken = accessToken
	result.AccessExpiresAt = accessExpiresAt
	result.RefreshToken = refreshPlain
	result.RefreshExpiresAt = refreshExpiresAt
	return result, nil
}

// Refresh 用 Refresh Token 换取新的令牌对，并轮换旧令牌。
func (s *Service) Refresh(ctx context.Context, refreshToken string) (LoginResult, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return LoginResult{}, apperr.New(apperr.CodeRefreshTokenInvalid)
	}
	now := time.Now()
	hash := auth.HashToken(refreshToken)

	var userID string
	var oldTokenID string
	err := s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		row, err := s.findRefreshToken(ctx, tx, hash)
		if err != nil {
			if isNoRows(err) {
				return apperr.New(apperr.CodeRefreshTokenInvalid)
			}
			return apperr.Internal(err)
		}
		if row.RevokedAt != nil || now.After(row.ExpiresAt) {
			return apperr.New(apperr.CodeRefreshTokenInvalid)
		}
		userID = row.UserID
		oldTokenID = row.ID
		return nil
	})
	if err != nil {
		return LoginResult{}, err
	}

	newPlain, newHash, err := auth.GenerateRefreshToken()
	if err != nil {
		return LoginResult{}, apperr.Internal(err)
	}
	refreshExpiresAt := now.Add(s.tokens.RefreshTTL())

	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// 轮换：旧令牌立即作废，被窃取的令牌只能使用一次。
		if err := q.RevokeRefreshToken(ctx, oldTokenID); err != nil {
			return apperr.Internal(err)
		}
		if _, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
			ID:        idgen.New(idgen.PrefixRefreshToken),
			UserID:    userID,
			TokenHash: newHash,
			ExpiresAt: refreshExpiresAt,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	if err != nil {
		return LoginResult{}, err
	}

	accessToken, accessExpiresAt, err := s.tokens.IssueAccessToken(userID, now)
	if err != nil {
		return LoginResult{}, apperr.Internal(err)
	}
	return LoginResult{
		AccessToken:      accessToken,
		AccessExpiresAt:  accessExpiresAt,
		RefreshToken:     newPlain,
		RefreshExpiresAt: refreshExpiresAt,
	}, nil
}

// Logout 注销当前用户的全部 Refresh Token。
func (s *Service) Logout(ctx context.Context, userID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.RevokeAllRefreshTokens(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// toUserRow 把登录路径的最小用户信息转换成通用用户行。
func toUserRow(u UserRecord) dbgen.User {
	return dbgen.User{
		ID:          u.ID,
		Phone:       u.Phone,
		DisplayName: u.DisplayName,
		AvatarUrl:   u.AvatarURL,
		Timezone:    u.Timezone,
		Initialized: u.Initialized,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
	}
}

// defaultDisplayName 用手机号后四位生成初始昵称，用户可以随时修改。
func defaultDisplayName(phone string) string {
	if len(phone) >= 4 {
		return "用户" + phone[len(phone)-4:]
	}
	return "新用户"
}
