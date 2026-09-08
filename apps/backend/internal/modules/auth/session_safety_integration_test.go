package auth_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	authmodule "github.com/guoxiaozheng1/steward/apps/backend/internal/modules/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func openAuthTestDB(t *testing.T) (*database.DB, context.Context) {
	t.Helper()
	cfg := config.LoadForTest()
	if authURL := os.Getenv("STEWARD_TEST_AUTH_DATABASE_URL"); authURL != "" {
		cfg.DatabaseURL = authURL
	}
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过认证并发集成测试")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db, ctx
}

func createAuthTestUser(t *testing.T, db *database.DB, ctx context.Context, phone string) string {
	t.Helper()
	userID := idgen.New(idgen.PrefixUser)
	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "认证并发测试", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建认证测试账号失败：%v", err)
	}
	return userID
}

func uniqueAuthPhone(offset int64) string {
	return fmt.Sprintf("196%08d", (time.Now().UnixNano()+offset)%100000000)
}

func TestVerificationCodeConcurrentConsumptionOnlySucceedsOnce(t *testing.T) {
	db, ctx := openAuthTestDB(t)
	phone := uniqueAuthPhone(1)
	userID := createAuthTestUser(t, db, ctx, phone)
	err := db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.CreateVerificationCode(ctx, dbgen.CreateVerificationCodeParams{
			ID: idgen.New(idgen.PrefixVerificationCode), Phone: phone,
			Purpose: "account_delete_reauth", CodeHash: authpkg.HashToken("123456"),
			ExpiresAt: time.Now().Add(5 * time.Minute),
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备验证码失败：%v", err)
	}

	svc := authmodule.New(db,
		authpkg.NewTokenService("test-auth-session-safety-secret-32-bytes", time.Hour, 24*time.Hour),
		nil, "123456", nil)
	start := make(chan struct{})
	var successes atomic.Int32
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			_, _, err := svc.ReauthenticateAccountDeletion(ctx, userID,
				fmt.Sprintf("concurrent-reauth-%d", index), "123456")
			if err == nil {
				successes.Add(1)
			}
			errs <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)

	if successes.Load() != 1 {
		t.Fatalf("同一验证码并发消费应只有一个成功，实际成功 %d 个", successes.Load())
	}
	var invalids int
	for err := range errs {
		var domainErr *apperr.Error
		if errors.As(err, &domainErr) && domainErr.Code == apperr.CodeCodeInvalid {
			invalids++
		}
	}
	if invalids != 1 {
		t.Fatalf("失败请求应明确返回验证码无效，实际 %d 个", invalids)
	}
}

func TestRefreshTokenConcurrentReplayRevokesWholeFamily(t *testing.T) {
	db, ctx := openAuthTestDB(t)
	userID := createAuthTestUser(t, db, ctx, uniqueAuthPhone(2))
	oldID := idgen.New(idgen.PrefixRefreshToken)
	oldPlain := "refresh-concurrent-" + oldID
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
			ID: oldID, UserID: userID, TokenHash: authpkg.HashToken(oldPlain),
			ExpiresAt: time.Now().Add(24 * time.Hour), FamilyID: oldID,
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备 Refresh Token 失败：%v", err)
	}

	svc := authmodule.New(db,
		authpkg.NewTokenService("test-auth-session-safety-secret-32-bytes", time.Hour, 24*time.Hour),
		nil, "123456", nil)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := svc.Refresh(ctx, oldPlain)
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	var successes, invalids int
	var unexpected []error
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		var domainErr *apperr.Error
		if errors.As(err, &domainErr) && domainErr.Code == apperr.CodeRefreshTokenInvalid {
			invalids++
		} else {
			unexpected = append(unexpected, err)
		}
	}
	if successes != 1 || invalids != 1 {
		t.Fatalf("并发轮换应一成一败，实际成功 %d、重放拒绝 %d、意外错误 %v", successes, invalids, unexpected)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var active int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_refresh_tokens
			WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL`, userID, oldID).Scan(&active); err != nil {
			return err
		}
		if active != 0 {
			t.Fatalf("检测到旧 Token 重放后 family 仍有 %d 个有效 Token", active)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("检查 Refresh family 失败：%v", err)
	}
}

func TestChangePhoneReplayKeepsCurrentFamilyAndRevokesOthers(t *testing.T) {
	db, ctx := openAuthTestDB(t)
	oldPhone, newPhone := uniqueAuthPhone(3), uniqueAuthPhone(4)
	userID := createAuthTestUser(t, db, ctx, oldPhone)
	currentID, otherID := idgen.New(idgen.PrefixRefreshToken), idgen.New(idgen.PrefixRefreshToken)
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, tokenID := range []string{currentID, otherID} {
			if _, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
				ID: tokenID, UserID: userID, TokenHash: authpkg.HashToken("plain-" + tokenID),
				ExpiresAt: time.Now().Add(24 * time.Hour), FamilyID: tokenID,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("准备设备会话失败：%v", err)
	}
	err = db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		for _, phone := range []string{oldPhone, newPhone} {
			if _, err := q.CreateVerificationCode(ctx, dbgen.CreateVerificationCodeParams{
				ID: idgen.New(idgen.PrefixVerificationCode), Phone: phone,
				Purpose: "change_phone", CodeHash: authpkg.HashToken("123456"),
				ExpiresAt: time.Now().Add(5 * time.Minute),
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("准备换绑验证码失败：%v", err)
	}

	svc := authmodule.New(db,
		authpkg.NewTokenService("test-auth-session-safety-secret-32-bytes", time.Hour, 24*time.Hour),
		nil, "123456", nil)
	for i := 0; i < 2; i++ {
		user, err := svc.ChangePhone(ctx, userID, currentID, "change-phone-replay",
			"123456", newPhone, "123456")
		if err != nil {
			t.Fatalf("第 %d 次换绑调用失败：%v", i+1, err)
		}
		if user.Phone != newPhone {
			t.Fatalf("换绑结果手机号错误：%s", user.Phone)
		}
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var currentRevoked, otherRevoked *time.Time
		if err := tx.QueryRow(ctx, `SELECT revoked_at FROM auth_refresh_tokens WHERE id = $1`, currentID).
			Scan(&currentRevoked); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT revoked_at FROM auth_refresh_tokens WHERE id = $1`, otherID).
			Scan(&otherRevoked); err != nil {
			return err
		}
		if currentRevoked != nil || otherRevoked == nil {
			t.Fatalf("换绑后的设备会话状态错误：当前=%v，其他=%v", currentRevoked, otherRevoked)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("检查换绑会话失败：%v", err)
	}
}

// 连续续期模拟跨进程使用已持久化凭证；同一事务还要保持调用者原有 RLS 身份。
func TestRefreshRotationPreservesCallerContext(t *testing.T) {
	db, ctx := openAuthTestDB(t)
	userID := createAuthTestUser(t, db, ctx, uniqueAuthPhone(11))
	otherID := createAuthTestUser(t, db, ctx, uniqueAuthPhone(12))
	tokenID := idgen.New(idgen.PrefixRefreshToken)
	plain, hash, err := authpkg.GenerateRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
			ID: tokenID, UserID: userID, TokenHash: hash, FamilyID: tokenID,
			ExpiresAt: time.Now().Add(time.Hour),
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, caller := range []string{"", otherID, ""} {
		nextPlain, nextHash, err := authpkg.GenerateRefreshToken()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := db.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", caller); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		var outcome, actualUser, family string
		err = tx.QueryRow(ctx, "SELECT outcome, user_id, family_id FROM auth_rotate_refresh_token($1,$2,$3,$4)",
			authpkg.HashToken(plain), idgen.New(idgen.PrefixRefreshToken), nextHash, time.Now().Add(time.Hour)).
			Scan(&outcome, &actualUser, &family)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if outcome != "rotated" || actualUser != userID || family != tokenID {
			_ = tx.Rollback(ctx)
			t.Fatalf("续期未保持账号及会话族：%s", outcome)
		}
		var restored string
		var visible int
		err = tx.QueryRow(ctx, "SELECT COALESCE(current_setting('app.user_id',true),''), (SELECT count(*) FROM auth_refresh_tokens)").Scan(&restored, &visible)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if restored != caller || visible != 0 {
			_ = tx.Rollback(ctx)
			t.Fatal("续期函数泄漏了目标账号的 RLS 上下文")
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		plain = nextPlain
	}
}

// 发布环境的函数属主没有超级用户或 BYPASSRLS；CI 也必须覆盖这一条件。
func TestRefreshFunctionOwnerCannotBypassRLS(t *testing.T) {
	if os.Getenv("STEWARD_TEST_AUTH_DATABASE_URL") == "" {
		t.Skip("通过 STEWARD_TEST_AUTH_DATABASE_URL 启用与线上一致的受限函数属主检查")
	}
	db, ctx := openAuthTestDB(t)
	var bypass bool
	err := db.Pool.QueryRow(ctx, `SELECT r.rolsuper OR r.rolbypassrls
		FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
		WHERE p.oid = 'auth_rotate_refresh_token(bytea,text,bytea,timestamptz)'::regprocedure`).Scan(&bypass)
	if err != nil {
		t.Fatal(err)
	}
	if bypass {
		t.Fatal("认证集成测试必须使用无超级用户和 BYPASSRLS 权限的函数属主，以覆盖线上 RLS 行为")
	}
}
