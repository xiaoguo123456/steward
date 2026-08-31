// Package auth 拥有登录、令牌签发与刷新。
//
// 验证码与 Refresh Token 都只以哈希形式落库；日志、埋点与测试快照
// 不得记录明文验证码或令牌。
package auth

import (
	"context"
	"crypto/subtle"
	"errors"
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
	// purposeChangePhone 是换绑手机号的验证码用途。
	//
	// 与登录分开是有意的：登录码不能拿来换绑，否则一个骗到登录码的人
	// 就能顺手把号码换走。限流口径也因此各算各的。
	purposeChangePhone = "change_phone"
	// purposeAccountDeleteReauth 是账号删除的独立验证码用途。
	purposeAccountDeleteReauth = "account_delete_reauth"
	// deletionReauthTTL 是单用途删除凭证有效期。
	deletionReauthTTL = 10 * time.Minute
)

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

// UserInitializer 是 users 模块公开的初始化能力。
type UserInitializer interface {
	EnsureDefaults(ctx context.Context, q *dbgen.Queries, userID string) error
}

// CodeSender 是验证码短信通道的最小边界。
type CodeSender interface {
	SendCode(ctx context.Context, phone, code, purpose string) error
}

// Service 是登录相关的应用服务。
type Service struct {
	db     *database.DB
	tokens *auth.TokenService
	users  UserInitializer
	// devCode 非空时跳过真实短信通道，固定使用该验证码，仅用于本地和测试环境。
	devCode string
	sender  CodeSender
}

// New 构造 Service。
func New(db *database.DB, tokens *auth.TokenService, users UserInitializer,
	devCode string, sender CodeSender) *Service {
	return &Service{db: db, tokens: tokens, users: users, devCode: devCode, sender: sender}
}

// CodeResult 是发送验证码的结果。
type CodeResult struct {
	ExpiresInSeconds   int
	ResendAfterSeconds int
	// DevCode 只在本地和测试环境返回，生产环境恒为空。
	DevCode string
}

// consumeCode 校验并消费一个验证码。
//
// 登录与换绑共用这一份：两份实现迟早会在「尝试次数」「过期」「已用过」
// 这些边界上走偏，而走偏的那一份就是可以被绕过的那一份。
func consumeCode(ctx context.Context, q *dbgen.Queries,
	phone, purpose, code string, now time.Time) error {

	record, err := q.GetLatestVerificationCode(ctx, dbgen.GetLatestVerificationCodeParams{
		Phone: phone, Purpose: purpose,
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
	return nil
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
	if s.devCode == "" && s.sender == nil {
		return CodeResult{}, apperr.New(apperr.CodeSMSProviderUnavailable)
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
	verificationCodeID := idgen.New(idgen.PrefixVerificationCode)
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		// 冷却期内重复请求直接拒绝，避免被用来轰炸短信。
		latest, err := q.GetLatestVerificationCode(ctx, dbgen.GetLatestVerificationCodeParams{
			Phone: phone, Purpose: purpose,
		})
		if err == nil && latest.ConsumedAt == nil && now.Sub(latest.CreatedAt) < resendCooldown {
			return apperr.Newf(apperr.CodeRateLimited, "请求过于频繁，请 %d 秒后重试。",
				int((resendCooldown-now.Sub(latest.CreatedAt)).Seconds())+1)
		}
		if err != nil && !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		if _, err := q.CreateVerificationCode(ctx, dbgen.CreateVerificationCodeParams{
			ID:        verificationCodeID,
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
	if err != nil {
		return CodeResult{}, err
	}
	if s.devCode != "" {
		return result, nil
	}

	// 外部短信调用不能占着数据库事务。发送失败时立即作废本次验证码，
	// 并允许用户立刻重试，不让一条未送达的验证码占用冷却时间。
	if err := s.sender.SendCode(ctx, phone, code, purpose); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		cleanupErr := s.db.InTxAnonymous(cleanupCtx, func(ctx context.Context, q *dbgen.Queries) error {
			return q.ConsumeVerificationCode(ctx, verificationCodeID)
		})
		cancel()
		if cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
		return CodeResult{}, apperr.New(apperr.CodeSMSProviderUnavailable).WithCause(err)
	}
	return result, nil
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
	// 首次登录写下的时区会跟着账号一辈子，之后每一次日期计算都用它。
	// 这里不拦，坏值就再也没有第二次机会被发现。
	if err := timeutil.ValidateLocation(timezone); err != nil {
		return LoginResult{}, apperr.Validation(apperr.Field("timezone", "时区名称不合法。"))
	}

	now := time.Now()
	var result LoginResult

	// 第一步：在匿名事务中校验验证码并确保用户存在。
	// 用户创建必须走 SECURITY DEFINER 函数，因为此时还没有 app.user_id。
	var userID string
	err := s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := consumeCode(ctx, q, phone, "login", code, now); err != nil {
			return err
		}

		existing, err := s.findUserByPhone(ctx, tx, phone)
		switch {
		case err == nil:
			if existing.AccountStatus != "active" {
				return apperr.New(apperr.CodeAccountNotActive)
			}
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
		ID:            u.ID,
		Phone:         u.Phone,
		DisplayName:   u.DisplayName,
		AvatarUrl:     u.AvatarURL,
		Timezone:      u.Timezone,
		Initialized:   u.Initialized,
		CreatedAt:     u.CreatedAt,
		UpdatedAt:     u.UpdatedAt,
		AccountStatus: u.AccountStatus,
	}
}

// RequestAccountDeletionCode 给当前绑定手机号发送删除重新认证验证码。
func (s *Service) RequestAccountDeletionCode(ctx context.Context, userID string) (CodeResult, error) {
	var phone string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetUser(ctx, userID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeAccountNotActive)
			}
			return apperr.Internal(err)
		}
		if row.AccountStatus != "active" {
			return apperr.New(apperr.CodeAccountNotActive)
		}
		phone = row.Phone
		return nil
	})
	if err != nil {
		return CodeResult{}, err
	}
	return s.RequestCode(ctx, phone, purposeAccountDeleteReauth)
}

// ReauthenticateAccountDeletion 消费验证码并签发一次性删除凭证。
func (s *Service) ReauthenticateAccountDeletion(
	ctx context.Context, userID, idempotencyKey, code string,
) (string, time.Time, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return "", time.Time{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	now := time.Now()
	plain := s.tokens.DeriveDeletionReauthToken(userID, idempotencyKey)
	hash := auth.HashToken(plain)
	requestHash := auth.HashToken(code)
	expiresAt := now.Add(deletionReauthTTL)

	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx,
			"account-deletion.reauth:"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		replayed, err := q.GetAccountDeletionReauthTokenByIdempotency(ctx,
			dbgen.GetAccountDeletionReauthTokenByIdempotencyParams{
				UserID: userID, IdempotencyKey: idempotencyKey,
			})
		if err == nil {
			if subtle.ConstantTimeCompare(replayed.RequestHash, requestHash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			if now.After(replayed.ExpiresAt) {
				return apperr.New(apperr.CodeReauthTokenExpired)
			}
			expiresAt = replayed.ExpiresAt
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}
		row, err := q.GetUser(ctx, userID)
		if err != nil || row.AccountStatus != "active" {
			return apperr.New(apperr.CodeAccountNotActive)
		}
		if err := consumeCode(ctx, q, row.Phone, purposeAccountDeleteReauth, code, now); err != nil {
			return err
		}
		created, err := q.CreateAccountDeletionReauthToken(ctx, dbgen.CreateAccountDeletionReauthTokenParams{
			ID: idgen.New(idgen.PrefixDeletionReauth), UserID: userID,
			IdempotencyKey: idempotencyKey, RequestHash: requestHash,
			TokenHash: hash, ExpiresAt: expiresAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		expiresAt = created.ExpiresAt
		return nil
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return plain, expiresAt, nil
}

// AccountActive 为无状态 Access Token 补一层实时账号状态检查。
func (s *Service) AccountActive(ctx context.Context, userID string) (bool, error) {
	var active bool
	err := s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT auth_account_is_active($1)`, userID).Scan(&active)
	})
	return active, err
}

// defaultDisplayName 用手机号后四位生成初始昵称，用户可以随时修改。
func defaultDisplayName(phone string) string {
	if len(phone) >= 4 {
		return "用户" + phone[len(phone)-4:]
	}
	return "新用户"
}

// ChangePhone 更换绑定的手机号。
//
// **要同时验证旧号与新号。** 这个产品的账号就是手机号（登录＝手机号＋验证码），
// 换绑是权限最高的操作：只验新号的话，一个被劫持的会话就能把号码换成攻击者的，
// 从此永久接管账号——而真正的机主再也登不进来，他的号码已经不对应任何账号了。
// 要求旧号的验证码意味着「光有一个会话不够」。
//
// 成功后撤销该用户的全部刷新令牌：换绑之后其他设备上的登录应当失效。
// 调用方负责给当前设备重新签发。
func (s *Service) ChangePhone(ctx context.Context, userID, currentCode,
	newPhone, newCode string) (dbgen.User, error) {

	newPhone = strings.TrimSpace(newPhone)
	if !phonePattern.MatchString(newPhone) {
		return dbgen.User{}, apperr.New(apperr.CodePhoneInvalid)
	}

	now := time.Now()
	var updated dbgen.User

	// 用带身份的事务：换绑发生在用户已经登录之后，users 表的 RLS 策略
	// 需要 app.user_id 才放行自己那一行。登录路径没有身份，所以那边走的是
	// SECURITY DEFINER 函数——两条路径的授权前提不同，不要混用。
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return apperr.Internal(err)
		}

		current, err := q.GetUser(ctx, userID)
		if err != nil {
			if isNoRows(err) {
				return apperr.NotFound("账号")
			}
			return apperr.Internal(err)
		}
		if current.Phone == newPhone {
			return apperr.Validation(apperr.Field("new_phone", "新手机号和当前的一样。"))
		}

		// 先确认新号没被别人占用。放在验证码之前：与其让用户输完两个码
		// 才被告知这个号不能用，不如立刻告诉他。
		//
		// 这里不构成手机号枚举——任何人本来就能对任意号码请求登录验证码。
		//
		// 查别人的行会被 RLS 挡住，所以走 SECURITY DEFINER 函数，
		// 和登录时找用户是同一个。
		if _, err := s.findUserByPhone(ctx, tx, newPhone); err == nil {
			return apperr.New(apperr.CodePhoneInUse)
		} else if !isNoRows(err) {
			return apperr.Internal(err)
		}

		// 两个码都要过。旧号在前：它证明「你是这个账号的主人」，
		// 新号在后：它证明「这个号确实在你手上」。
		if err := consumeCode(ctx, q, current.Phone, purposeChangePhone, currentCode, now); err != nil {
			return err
		}
		if err := consumeCode(ctx, q, newPhone, purposeChangePhone, newCode, now); err != nil {
			return err
		}

		row, err := q.UpdateUserPhone(ctx, dbgen.UpdateUserPhoneParams{
			Phone: newPhone, ID: userID,
		})
		if err != nil {
			// 并发换绑到同一个号码时唯一约束会在这里拦下。
			if isUniqueViolation(err) {
				return apperr.New(apperr.CodePhoneInUse)
			}
			return apperr.Internal(err)
		}
		updated = row

		// 换绑之后其他设备上的登录应当失效。
		if err := q.RevokeAllRefreshTokens(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	return updated, err
}

// RequestCurrentPhoneCode 给用户当前绑定的手机号发换绑验证码。
//
// 不接受手机号参数：手机号是脱敏下发的，客户端本来就拿不到完整号码；
// 而服务端已经知道请求者是谁，让客户端再传一遍只会多一个可以被篡改的入口。
func (s *Service) RequestCurrentPhoneCode(ctx context.Context, userID string) (CodeResult, error) {
	var phone string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetUser(ctx, userID)
		if err != nil {
			if isNoRows(err) {
				return apperr.NotFound("账号")
			}
			return apperr.Internal(err)
		}
		phone = row.Phone
		return nil
	})
	if err != nil {
		return CodeResult{}, err
	}
	return s.RequestCode(ctx, phone, purposeChangePhone)
}
