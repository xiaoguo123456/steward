package auth_test

import (
	"context"
	"errors"
	"fmt"
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
