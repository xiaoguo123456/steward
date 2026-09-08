package auth

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/jackc/pgx/v5"
)

// 管理员名单只能用验收库迁移账号建立，运行账号不得获得 INSERT／授权权限。
func seedAdminAccount(t *testing.T, db *database.DB, phone string, hash *string) string {
	t.Helper()
	dsn := os.Getenv("STEWARD_TEST_MIGRATE_URL")
	if dsn == "" {
		dsn = os.Getenv("STEWARD_MIGRATE_DATABASE_URL")
	}
	if dsn == "" {
		t.Fatal("后台认证集成测试必须设置独立验收库 STEWARD_TEST_MIGRATE_URL")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal("无法连接验收库迁移账号")
	}
	var name string
	if err = conn.QueryRow(ctx, "SELECT current_database()").Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != db.Pool.Config().ConnConfig.Database {
		_ = conn.Close(ctx)
		t.Fatal("认证 Fixture 与后台验收库不一致")
	}
	id := idgen.New("adm")
	_, err = conn.Exec(ctx, "INSERT INTO admin.accounts(id,phone,password_hash) VALUES($1,$2,$3)", id, phone, hash)
	if err != nil {
		_ = conn.Close(ctx)
		t.Fatal("创建独立管理员 Fixture 失败")
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(ctx, "DELETE FROM admin.sessions WHERE admin_id=$1", id)
		_, _ = conn.Exec(ctx, "DELETE FROM admin.accounts WHERE id=$1", id)
		_ = conn.Close(ctx)
	})
	return id
}

func phoneService(t *testing.T) (*Service, *database.DB) {
	svc, db := testService(t, func(c *config.AdminConfig) { c.Environment = "test"; c.DevSMSCode = "123456" })
	return svc, db
}

func expireCooldown(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(context.Background(), "UPDATE admin.phone_challenges SET created_at=now()-interval '61 seconds' WHERE admin_id=(SELECT id FROM admin.accounts WHERE phone='19900000901')"); err != nil {
		t.Fatal(err)
	}
}

func TestPhoneFirstLoginRequiresPassword(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	if _, err := db.Pool.Exec(ctx, "UPDATE admin.accounts SET password_hash=NULL WHERE phone='19900000901'"); err != nil {
		t.Fatal(err)
	}
	id, err := svc.requestCode(ctx, "19900000901", "login")
	if err != nil {
		t.Fatal(err)
	}
	input := loginCredentials{Phone: "19900000901", Method: "sms", ChallengeID: id, Code: "123456"}
	if token, _, err := svc.authenticate(ctx, input, "test", nil); !errors.Is(err, ErrPasswordSetup) || token != "" {
		t.Fatal("首次短信验证不得提前创建会话")
	}
	input.NewPassword = "new-password-for-admin"
	token, session, err := svc.authenticate(ctx, input, "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := svc.Validate(ctx, token)
	if err != nil || restored.CSRFToken == "" || restored.CSRFToken != session.CSRFToken {
		t.Fatal("刷新页面必须恢复同一会话的 CSRF")
	}
	if err = svc.VerifyCSRF(ctx, restored.ID, restored.CSRFToken); err != nil {
		t.Fatal(err)
	}
	if _, _, err = svc.Login(ctx, "19900000901", input.NewPassword, "test", nil); err != nil {
		t.Fatal("首次设密后应支持密码登录")
	}
	input.NewPassword = ""
	if _, _, err = svc.authenticate(ctx, input, "test", nil); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("验证码不能重复使用")
	}
}

func TestPhoneWrongAttemptsPersistAndConcurrentCodeConsumedOnce(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	id, err := svc.requestCode(ctx, "19900000901", "login")
	if err != nil {
		t.Fatal(err)
	}
	input := loginCredentials{Phone: "19900000901", Method: "sms", ChallengeID: id, Code: "000000"}
	for i := 0; i < 5; i++ {
		if _, _, err = svc.authenticate(ctx, input, "test", nil); !errors.Is(err, ErrCodeInvalid) {
			t.Fatal("错误验证码必须拒绝")
		}
	}
	input.Code = "123456"
	if _, _, err = svc.authenticate(ctx, input, "test", nil); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("超过尝试次数后正确验证码也不能通过")
	}
	expireCooldown(t, db)
	input.ChallengeID, err = svc.requestCode(ctx, input.Phone, "login")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var successes atomic.Int32
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := svc.authenticate(ctx, input, "test", nil); err == nil {
				successes.Add(1)
			} else if !errors.Is(err, ErrCodeInvalid) {
				t.Error("并发验证出现非业务错误")
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatal("一个验证码必须只建立一次会话")
	}
}

func TestPhoneResetPurposeAndSessionRevocation(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	old, _, err := svc.Login(ctx, "19900000901", "test-admin-password", "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	id, err := svc.requestCode(ctx, "19900000901", "login")
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.resetPassword(ctx, "19900000901", id, "123456", "changed-password-for-admin"); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("登录验证码不能改密码")
	}
	expireCooldown(t, db)
	id, err = svc.requestCode(ctx, "19900000901", "password_reset")
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.resetPassword(ctx, "19900000901", id, "123456", "changed-password-for-admin"); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Validate(ctx, old); err == nil {
		t.Fatal("重设密码后旧会话必须失效")
	}
	if _, _, err = svc.Login(ctx, "19900000901", "test-admin-password", "test", nil); !errors.Is(err, ErrInvalidLogin) {
		t.Fatal("旧密码必须失效")
	}
	if _, _, err = svc.Login(ctx, "19900000901", "changed-password-for-admin", "test", nil); err != nil {
		t.Fatal(err)
	}
	if err = svc.resetPassword(ctx, "19900000901", id, "123456", "another-password-for-admin"); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("重设验证码不能重放")
	}
}

func TestPhoneWhitelistAndRuntimePrivileges(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	id, err := svc.requestCode(ctx, "19900000999", "login")
	if err != nil || id == "" {
		t.Fatal("未授权号码保持统一发送提示")
	}
	if _, _, err = svc.authenticate(ctx, loginCredentials{Phone: "19900000999", Method: "sms", ChallengeID: id, Code: "123456"}, "test", nil); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("未授权手机号不能登录")
	}
	for _, statement := range []string{
		"INSERT INTO admin.accounts(id,phone) VALUES('forbidden','19900000888')",
		"UPDATE admin.accounts SET enabled=false WHERE phone='19900000901'",
		"UPDATE admin.accounts SET phone='19900000888' WHERE phone='19900000901'",
	} {
		if _, err = db.Pool.Exec(ctx, statement); err == nil {
			t.Fatal("运行账号不能管理管理员名单")
		}
	}
}

func TestPhoneExpiryAndCooldown(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	id, err := svc.requestCode(ctx, "19900000901", "login")
	if err != nil {
		t.Fatal(err)
	}
	var count int
	_, err = svc.requestCode(ctx, "19900000901", "password_reset")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Pool.QueryRow(ctx, "SELECT count(*) FROM admin.phone_challenges WHERE admin_id=(SELECT id FROM admin.accounts WHERE phone='19900000901')").Scan(&count); err != nil || count != 1 {
		t.Fatal("切换验证码用途不得绕过手机号冷却")
	}
	if _, err = db.Pool.Exec(ctx, "UPDATE admin.phone_challenges SET expires_at=now()-interval '1 second' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	if _, _, err = svc.authenticate(ctx, loginCredentials{Phone: "19900000901", Method: "sms", ChallengeID: id, Code: "123456"}, "test", nil); !errors.Is(err, ErrCodeInvalid) {
		t.Fatal("过期验证码必须拒绝")
	}
}

func TestAdminLimitPreventsConcurrentBypass(t *testing.T) {
	limiter := NewLoginLimiter()
	var count atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if limiter.Take("fixture-ip", "fixture-admin") {
				count.Add(1)
			}
		}()
	}
	wg.Wait()
	if count.Load() != 10 {
		t.Fatal("并发请求不能绕过来源限流")
	}
}

func TestPasswordPolicy(t *testing.T) {
	for _, value := range []string{"short", "            "} {
		if validNewPassword(value) {
			t.Fatal("弱长度或全空白密码必须拒绝")
		}
	}
	if !validNewPassword("long-password-for-admin") {
		t.Fatal("合法密码不应拒绝")
	}
}

func TestPhoneProductionNeverUsesDevCode(t *testing.T) {
	svc, _ := phoneService(t)
	svc.cfg.Environment = "production"
	if _, err := svc.requestCode(context.Background(), "19900000901", "login"); !errors.Is(err, ErrSMSUnavailable) {
		t.Fatal("生产环境不能退回固定验证码")
	}
}

func TestPhoneDisabledAccountInvalidatesSession(t *testing.T) {
	svc, db := phoneService(t)
	ctx := context.Background()
	token, _, err := svc.Login(ctx, "19900000901", "test-admin-password", "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	dsn := os.Getenv("STEWARD_TEST_MIGRATE_URL")
	if dsn == "" {
		dsn = os.Getenv("STEWARD_MIGRATE_DATABASE_URL")
	}
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err = conn.Exec(ctx, "UPDATE admin.accounts SET enabled=false WHERE phone='19900000901'"); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Validate(ctx, token); !errors.Is(err, ErrSessionRevoked) {
		t.Fatal("管理员停用后现有会话必须拒绝")
	}
	if _, _, err = svc.Login(ctx, "19900000901", "test-admin-password", "test", nil); !errors.Is(err, ErrInvalidLogin) {
		t.Fatal("停用管理员不能重新登录")
	}
	_ = db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error { return q.PurgeAdminPhoneChallenges(ctx) })
}
