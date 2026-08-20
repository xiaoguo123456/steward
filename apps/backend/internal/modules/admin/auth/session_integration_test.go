package auth

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 后台会话的集成测试。
//
// 会话的全部语义（空闲超时、绝对超时、撤销、凭证版本）都靠数据库里的
// 时间戳判断，用 mock 测不出真实行为，因此这些必须连真库。
//
// 没配 STEWARD_TEST_DATABASE_URL 时跳过，先跑 make migrate-test。

func testService(t *testing.T, mutate func(*config.AdminConfig)) (*Service, *database.DB) {
	t.Helper()
	dsn := config.AdminTestDatabaseURL()
	if dsn == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过后台会话集成测试")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	hash, err := HashPassword("test-admin-password")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.AdminConfig{
		Username:          "tester",
		PasswordHash:      hash,
		CredentialVersion: "1",
		SessionSecret:     "session-secret-for-tests-0123456789",
		CSRFSecret:        "csrf-secret-for-tests-0123456789ab",
		IdleTimeout:       30 * time.Minute,
		AbsoluteTimeout:   12 * time.Hour,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	return NewService(db, cfg), db
}

func TestLoginCreatesSessionAndValidates(t *testing.T) {
	svc, _ := testService(t, nil)
	ctx := context.Background()

	token, session, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatalf("登录失败：%v", err)
	}
	if token == "" || session.CSRFToken == "" {
		t.Fatal("令牌与 CSRF Token 都不该为空")
	}
	// 两个令牌必须不同：CSRF 是要交给 JavaScript 的，
	// 如果它等于会话令牌，等于把 HttpOnly 那道防护直接绕开。
	if token == session.CSRFToken {
		t.Error("会话令牌与 CSRF Token 不能相同")
	}

	got, err := svc.Validate(ctx, token)
	if err != nil {
		t.Fatalf("校验应当通过：%v", err)
	}
	if got.ID != session.ID {
		t.Errorf("会话 ID 不一致：%s vs %s", got.ID, session.ID)
	}
}

func TestLoginRejectsWrongCredentials(t *testing.T) {
	svc, _ := testService(t, nil)
	ctx := context.Background()

	for name, attempt := range map[string][2]string{
		"用户名错": {"wrong", "test-admin-password"},
		"口令错":  {"tester", "wrong-password"},
		"都错":   {"wrong", "wrong-password"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := svc.Login(ctx, attempt[0], attempt[1], "go-test", nil); err != ErrInvalidLogin {
				t.Errorf("应当返回 ErrInvalidLogin，实际 %v", err)
			}
		})
	}
}

// 令牌**不能**明文入库：库被读走时攻击者不该拿到能直接用的 Cookie。
func TestSessionTokenIsNotStoredInPlaintext(t *testing.T) {
	svc, db := testService(t, nil)
	ctx := context.Background()

	token, session, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}

	var count int
	err = db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT count(*) FROM admin.sessions WHERE id = $1 AND encode(session_token_hash,'escape') = $2",
			session.ID, token).Scan(&count)
	})
	if err != nil {
		t.Fatalf("查询失败：%v", err)
	}
	if count != 0 {
		t.Error("库里出现了明文令牌")
	}
}

func TestValidateRejectsUnknownToken(t *testing.T) {
	svc, _ := testService(t, nil)
	if _, err := svc.Validate(context.Background(), "not-a-real-token"); err != ErrNoSession {
		t.Errorf("未知令牌应当返回 ErrNoSession，实际 %v", err)
	}
	if _, err := svc.Validate(context.Background(), ""); err != ErrNoSession {
		t.Error("空令牌应当返回 ErrNoSession")
	}
}

func TestValidateRejectsRevokedSession(t *testing.T) {
	svc, _ := testService(t, nil)
	ctx := context.Background()

	token, session, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Logout(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(ctx, token); err != ErrSessionRevoked {
		t.Errorf("已撤销的会话应当返回 ErrSessionRevoked，实际 %v", err)
	}
}

// 空闲超时：一段时间没请求就失效。
func TestValidateRejectsIdleExpiredSession(t *testing.T) {
	svc, _ := testService(t, func(c *config.AdminConfig) {
		// 负的空闲超时让会话建出来就已经过期，不用真等。
		c.IdleTimeout = -time.Second
	})
	ctx := context.Background()

	token, _, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(ctx, token); err != ErrSessionExpired {
		t.Errorf("空闲超时应当返回 ErrSessionExpired，实际 %v", err)
	}
}

// 绝对超时：不管有没有一直在用，到点就失效。
//
// 只有空闲超时的话，一个一直开着的标签页可以让会话永远活着。
func TestValidateRejectsAbsoluteExpiredSession(t *testing.T) {
	svc, _ := testService(t, func(c *config.AdminConfig) {
		c.AbsoluteTimeout = -time.Second
	})
	ctx := context.Background()

	token, _, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(ctx, token); err != ErrSessionExpired {
		t.Errorf("绝对超时应当返回 ErrSessionExpired，实际 %v", err)
	}
}

// 空闲超时往后推时**不能越过绝对超时**。
//
// 否则一直点着页面就能把会话续到天荒地老，绝对超时白设了。
func TestValidateDoesNotExtendBeyondAbsolute(t *testing.T) {
	svc, _ := testService(t, func(c *config.AdminConfig) {
		c.IdleTimeout = time.Hour
		c.AbsoluteTimeout = 2 * time.Second
	})
	ctx := context.Background()

	token, _, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Validate(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if got.ExpiresAt.After(got.AbsoluteExpiresAt) {
		t.Errorf("空闲超时 %v 越过了绝对超时 %v", got.ExpiresAt, got.AbsoluteExpiresAt)
	}
}

// 凭证版本变化后旧会话立即失效。
//
// 改口令时不用逐条去删会话，也不会漏掉正在用的那些。
func TestValidateRejectsStaleCredentialVersion(t *testing.T) {
	svc, db := testService(t, nil)
	ctx := context.Background()

	token, _, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(ctx, token); err != nil {
		t.Fatalf("换版本之前应当有效：%v", err)
	}

	// 换一个凭证版本的服务，指向同一个库。
	rotated := NewService(db, config.AdminConfig{
		Username:          svc.cfg.Username,
		PasswordHash:      svc.cfg.PasswordHash,
		CredentialVersion: "2",
		SessionSecret:     svc.cfg.SessionSecret,
		CSRFSecret:        svc.cfg.CSRFSecret,
		IdleTimeout:       svc.cfg.IdleTimeout,
		AbsoluteTimeout:   svc.cfg.AbsoluteTimeout,
	})
	if _, err := rotated.Validate(ctx, token); err != ErrCredentialsStale {
		t.Errorf("凭证版本变化后应当返回 ErrCredentialsStale，实际 %v", err)
	}
}

func TestVerifyCSRF(t *testing.T) {
	svc, _ := testService(t, nil)
	ctx := context.Background()

	_, session, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.VerifyCSRF(ctx, session.ID, session.CSRFToken); err != nil {
		t.Errorf("正确的 CSRF Token 应当通过：%v", err)
	}
	for name, token := range map[string]string{
		"空":   "",
		"伪造的": "forged-csrf-token",
	} {
		if err := svc.VerifyCSRF(ctx, session.ID, token); err != ErrCSRFInvalid {
			t.Errorf("%s CSRF 应当被拒", name)
		}
	}

	// 另一个会话的 CSRF Token 不能用在这个会话上。
	_, other, err := svc.Login(ctx, "tester", "test-admin-password", "go-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.VerifyCSRF(ctx, session.ID, other.CSRFToken); err != ErrCSRFInvalid {
		t.Error("跨会话的 CSRF Token 不该通过")
	}
}
