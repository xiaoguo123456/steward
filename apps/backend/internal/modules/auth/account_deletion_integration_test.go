package auth_test

import (
	"context"
	"errors"
	"fmt"
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

func TestAccountDeletionReauthCanReplayWithoutConsumingAnotherCode(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过删除重新认证幂等集成测试")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("195%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "删除认证测试用户", "Asia/Shanghai").Scan(&userID); err != nil {
			return err
		}
		_, err = q.CreateVerificationCode(ctx, dbgen.CreateVerificationCodeParams{
			ID: idgen.New(idgen.PrefixVerificationCode), Phone: phone,
			Purpose: "account_delete_reauth", CodeHash: authpkg.HashToken("123456"),
			ExpiresAt: time.Now().Add(5 * time.Minute),
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备账号与验证码失败：%v", err)
	}

	tokens := authpkg.NewTokenService("test-account-deletion-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	svc := authmodule.New(db, tokens, nil, "123456", nil)
	first, firstExpiry, err := svc.ReauthenticateAccountDeletion(ctx, userID, "reauth-key", "123456")
	if err != nil {
		t.Fatalf("首次重新认证失败：%v", err)
	}
	replayed, replayExpiry, err := svc.ReauthenticateAccountDeletion(ctx, userID, "reauth-key", "123456")
	if err != nil {
		t.Fatalf("网络重试的同键重放失败：%v", err)
	}
	if first != replayed || !firstExpiry.Equal(replayExpiry) {
		t.Fatal("同键重放没有返回相同凭证和有效期")
	}

	_, _, err = svc.ReauthenticateAccountDeletion(ctx, userID, "reauth-key", "654321")
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeIdempotencyReused {
		t.Fatalf("同键不同验证码应被拒绝，实际：%v", err)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var storedHash []byte
		var consumedAt *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT token_hash FROM account_deletion_reauth_tokens
			WHERE user_id = $1 AND idempotency_key = 'reauth-key'`, userID).Scan(&storedHash); err != nil {
			return err
		}
		if string(storedHash) != string(authpkg.HashToken(first)) {
			t.Fatal("数据库没有按哈希保存重新认证凭证")
		}
		if err := tx.QueryRow(ctx, `
			SELECT consumed_at FROM auth_verification_codes
			WHERE phone = $1 AND purpose = 'account_delete_reauth'`, phone).Scan(&consumedAt); err != nil {
			return err
		}
		if consumedAt == nil {
			t.Fatal("首次重新认证没有消费验证码")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("检查重新认证存储失败：%v", err)
	}
}
