package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// CookieName 是会话 Cookie 的名字。
//
// 和用户端的 Cookie 不同名、不同域、不同进程——一个用户端的 Cookie
// 无论如何都不可能被当成管理员会话使用。
const CookieName = "steward_admin_session"

// 会话失效的几种原因。分开是因为它们的处理方式不同：
// 空闲超时重新登录即可，凭证版本变化说明口令被换过，
// 后者往往意味着有人在处理一次安全事件。
var (
	ErrNoSession        = errors.New("没有会话")
	ErrSessionExpired   = errors.New("会话已过期")
	ErrSessionRevoked   = errors.New("会话已撤销")
	ErrCredentialsStale = errors.New("凭证已更新，请重新登录")
	ErrInvalidLogin     = errors.New("用户名或口令不正确")
	ErrCSRFInvalid      = errors.New("CSRF 校验未通过")
)

// Session 是校验通过后的会话信息。
type Session struct {
	ID string
	// Username 是操作者身份，审计要靠它回答「谁做的」。
	// 取自配置：这套后台目前只有一个账号，用户名就是它的真实身份。
	Username          string
	CSRFToken         string
	ExpiresAt         time.Time
	AbsoluteExpiresAt time.Time
}

// Service 管理后台会话。
type Service struct {
	db  *database.DB
	cfg config.AdminConfig
}

// NewService 构造会话服务。
func NewService(db *database.DB, cfg config.AdminConfig) *Service {
	return &Service{db: db, cfg: cfg}
}

// Login 校验口令并建立会话。
//
// 返回的第一个值是要写进 Cookie 的原始令牌，**它不进数据库**，
// 库里只有它的散列。
func (s *Service) Login(ctx context.Context, username, password, userAgent string,
	ipHash []byte) (string, Session, error) {

	// 用户名也用定长比较：短路比较会按字符逐个泄漏，
	// 让攻击者能一位一位地把用户名试出来。
	userOK := hmac.Equal([]byte(username), []byte(s.cfg.Username))
	passOK := VerifyPassword(password, s.cfg.PasswordHash)

	// **两个都算完再判断。** 写成 userOK && VerifyPassword(...) 的话，
	// 用户名不对时会跳过昂贵的 Argon2 计算，响应时间明显更短——
	// 那等于免费告诉攻击者「这个用户名不存在」。
	if !userOK || !passOK {
		return "", Session{}, ErrInvalidLogin
	}

	token, err := randomToken()
	if err != nil {
		return "", Session{}, err
	}
	csrfToken, err := randomToken()
	if err != nil {
		return "", Session{}, err
	}

	now := time.Now()
	row := dbgen.CreateAdminSessionParams{
		ID:                idgen.New(idgen.PrefixAdminSession),
		SessionTokenHash:  s.hashToken(token),
		CsrfSecretHash:    s.hashCSRF(csrfToken),
		CredentialVersion: s.cfg.CredentialVersion,
		ExpiresAt:         now.Add(s.cfg.IdleTimeout),
		AbsoluteExpiresAt: now.Add(s.cfg.AbsoluteTimeout),
		UserAgent:         truncate(userAgent, 512),
		IpHash:            ipHash,
	}

	var created dbgen.AdminSession
	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		out, err := q.CreateAdminSession(ctx, row)
		if err != nil {
			return err
		}
		created = out
		// 顺手清掉早就绝对过期的会话，不另开一个定时任务。
		_ = q.PurgeExpiredAdminSessions(ctx)
		return nil
	})
	if err != nil {
		return "", Session{}, err
	}

	return token, Session{
		ID:                created.ID,
		Username:          s.cfg.Username,
		CSRFToken:         csrfToken,
		ExpiresAt:         created.ExpiresAt,
		AbsoluteExpiresAt: created.AbsoluteExpiresAt,
	}, nil
}

// Validate 校验 Cookie 里的令牌，并把空闲超时往后推。
func (s *Service) Validate(ctx context.Context, token string) (Session, error) {
	if strings.TrimSpace(token) == "" {
		return Session{}, ErrNoSession
	}

	var row dbgen.AdminSession
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		out, err := q.FindAdminSession(ctx, s.hashToken(token))
		if err != nil {
			return err
		}
		row = out
		return nil
	})
	if err != nil {
		if database.IsNoRows(err) {
			return Session{}, ErrNoSession
		}
		return Session{}, err
	}

	now := time.Now()
	switch {
	case row.RevokedAt != nil:
		return Session{}, ErrSessionRevoked
	case now.After(row.AbsoluteExpiresAt):
		return Session{}, ErrSessionExpired
	case now.After(row.ExpiresAt):
		return Session{}, ErrSessionExpired
	case row.CredentialVersion != s.cfg.CredentialVersion:
		// 口令或密钥换过了。旧会话立刻作废，不用逐条删。
		return Session{}, ErrCredentialsStale
	}

	// 往后推空闲超时，但**不超过绝对超时**。
	next := now.Add(s.cfg.IdleTimeout)
	if next.After(row.AbsoluteExpiresAt) {
		next = row.AbsoluteExpiresAt
	}
	_ = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.TouchAdminSession(ctx, dbgen.TouchAdminSessionParams{ID: row.ID, ExpiresAt: next})
	})

	return Session{
		ID:                row.ID,
		Username:          s.cfg.Username,
		ExpiresAt:         next,
		AbsoluteExpiresAt: row.AbsoluteExpiresAt,
	}, nil
}

// VerifyCSRF 校验写请求带的 CSRF Token 与会话是否配套。
func (s *Service) VerifyCSRF(ctx context.Context, sessionID, csrfToken string) error {
	if strings.TrimSpace(csrfToken) == "" {
		return ErrCSRFInvalid
	}
	var row dbgen.AdminSession
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		// 这里按 ID 找不到就说明会话刚被撤销，同样按 CSRF 失败处理。
		out, err := q.FindAdminSessionByID(ctx, sessionID)
		if err != nil {
			return err
		}
		row = out
		return nil
	})
	if err != nil {
		return ErrCSRFInvalid
	}
	if !hmac.Equal(s.hashCSRF(csrfToken), row.CsrfSecretHash) {
		return ErrCSRFInvalid
	}
	return nil
}

// Logout 撤销会话。
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.RevokeAdminSession(ctx, sessionID)
	})
}

// hashToken 用会话密钥做 HMAC 而不是裸 SHA-256。
//
// 差别在于：裸散列的话，拿到数据库的人可以直接对候选令牌算散列来比对；
// 带密钥之后，没有密钥就算不出来。令牌本身是高熵随机数，这一层是纵深防御。
func (s *Service) hashToken(token string) []byte {
	mac := hmac.New(sha256.New, []byte(s.cfg.SessionSecret))
	mac.Write([]byte(token))
	return mac.Sum(nil)
}

// hashCSRF 用**独立的**密钥。
// 和会话密钥分开，一次泄漏才不会同时打穿两道防线。
func (s *Service) hashCSRF(token string) []byte {
	mac := hmac.New(sha256.New, []byte(s.cfg.CSRFSecret))
	mac.Write([]byte(token))
	return mac.Sum(nil)
}

// randomToken 生成 256 位随机令牌。
func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
