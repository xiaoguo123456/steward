package retention_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/retention"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

type deletionQueue struct{ requests []string }

func (q *deletionQueue) EnqueueAccountDeletion(
	_ context.Context, _ *dbgen.Queries, args retention.AccountDeletionArgs,
) error {
	q.requests = append(q.requests, args.RequestID)
	return nil
}

type deletionStore struct{ deleted []string }

func (*deletionStore) Name() string { return "test" }
func (*deletionStore) PresignUpload(context.Context, string, string, time.Duration) (storage.UploadGrant, error) {
	return storage.UploadGrant{}, nil
}
func (*deletionStore) PresignRead(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
func (*deletionStore) Stat(context.Context, string) (storage.Asset, error) {
	return storage.Asset{}, storage.ErrNotFound
}
func (*deletionStore) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (s *deletionStore) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}

func TestAccountDeletionClosesSessionsPurgesDataAndKeepsPublicStatus(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过账号删除闭环集成测试")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("197%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "删除闭环测试用户", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建用户失败：%v", err)
	}

	const reauthToken = "reauth-token-for-integration-test"
	mediaID := idgen.New(idgen.PrefixMedia)
	softDeletedMediaID := idgen.New(idgen.PrefixMedia)
	operationID := idgen.New(idgen.PrefixOperation)
	refreshID := idgen.New(idgen.PrefixRefreshToken)
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateAccountDeletionReauthToken(ctx,
			dbgen.CreateAccountDeletionReauthTokenParams{
				ID: idgen.New(idgen.PrefixDeletionReauth), UserID: userID,
				IdempotencyKey: "reauth-key", RequestHash: authpkg.HashToken("123456"),
				TokenHash: authpkg.HashToken(reauthToken), ExpiresAt: time.Now().Add(10 * time.Minute),
			}); err != nil {
			return err
		}
		if _, err := q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{
			ID: refreshID, UserID: userID, TokenHash: authpkg.HashToken("refresh"),
			ExpiresAt: time.Now().Add(time.Hour),
		}); err != nil {
			return err
		}
		if _, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID: operationID, UserID: userID, Kind: "capture_parse",
		}); err != nil {
			return err
		}
		if _, err := q.CreateMediaAsset(ctx, dbgen.CreateMediaAssetParams{
			ID: mediaID, UserID: userID, ObjectKey: userID + "/" + mediaID + ".jpg",
			Kind: "image", ContentType: "image/jpeg",
		}); err != nil {
			return err
		}
		if _, err := q.CreateMediaAsset(ctx, dbgen.CreateMediaAssetParams{
			ID: softDeletedMediaID, UserID: userID,
			ObjectKey: userID + "/" + softDeletedMediaID + ".jpg",
			Kind:      "image", ContentType: "image/jpeg",
		}); err != nil {
			return err
		}
		_, err := q.SoftDeleteMediaAsset(ctx, softDeletedMediaID)
		return err
	})
	if err != nil {
		t.Fatalf("准备用户数据失败：%v", err)
	}

	queue := &deletionQueue{}
	store := &deletionStore{}
	tokens := authpkg.NewTokenService("test-account-deletion-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	svc := retention.New(db, store, tokens, queue, 30*24*time.Hour)

	accepted, err := svc.Request(ctx, userID, reauthToken, "deletion-key", true)
	if err != nil {
		t.Fatalf("受理删除失败：%v", err)
	}
	if accepted.RequestID == "" || accepted.StatusToken == "" || accepted.Status != "accepted" {
		t.Fatalf("受理结果不完整：%+v", accepted)
	}
	if len(queue.requests) != 1 || queue.requests[0] != accepted.RequestID {
		t.Fatalf("删除任务没有与受理事务一起登记：%v", queue.requests)
	}

	replayed, err := svc.Request(ctx, userID, reauthToken, "deletion-key", true)
	if err != nil {
		t.Fatalf("同键重放失败：%v", err)
	}
	if replayed.RequestID != accepted.RequestID || replayed.StatusToken != accepted.StatusToken {
		t.Fatal("同键重放没有返回相同请求与状态凭证")
	}
	if len(queue.requests) != 1 {
		t.Fatal("幂等重放不应重复登记删除任务")
	}

	_, err = svc.Request(ctx, userID, reauthToken, "another-key", true)
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeDeletionAlreadyReq {
		t.Fatalf("第二个删除请求应被稳定拒绝，实际：%v", err)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var status string
		var revokedAt *time.Time
		if err := tx.QueryRow(ctx, `SELECT account_status FROM users WHERE id = $1`, userID).Scan(&status); err != nil {
			return err
		}
		if status != "deletion_pending" {
			t.Fatalf("账号没有立即冻结，状态为 %s", status)
		}
		if err := tx.QueryRow(ctx, `SELECT revoked_at FROM auth_refresh_tokens WHERE id = $1`, refreshID).Scan(&revokedAt); err != nil {
			return err
		}
		if revokedAt == nil {
			t.Fatal("Refresh Token 没有立即撤销")
		}
		var operationStatus string
		if err := tx.QueryRow(ctx, `SELECT status FROM async_operations WHERE id = $1`, operationID).Scan(&operationStatus); err != nil {
			return err
		}
		if operationStatus != "cancelled" {
			t.Fatalf("异步操作没有取消：%s", operationStatus)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("检查受理副作用失败：%v", err)
	}

	if err := svc.RunDeletion(ctx, accepted.RequestID); err != nil {
		t.Fatalf("执行物理删除失败：%v", err)
	}
	if len(store.deleted) != 2 ||
		!containsObjectKey(store.deleted, mediaID) ||
		!containsObjectKey(store.deleted, softDeletedMediaID) {
		t.Fatalf("对象存储没有清理预期媒体：%v", store.deleted)
	}
	status, err := svc.Status(ctx, accepted.RequestID, accepted.StatusToken)
	if err != nil {
		t.Fatalf("主用户删除后不能读取独立状态：%v", err)
	}
	if status.Status != "completed" || status.CompletedAt == nil {
		t.Fatalf("删除状态没有完成：%+v", status)
	}
	afterPurgeReplay, err := svc.Request(ctx, userID, reauthToken, "deletion-key", true)
	if err != nil {
		t.Fatalf("主用户物理删除后不能重放首次受理结果：%v", err)
	}
	if afterPurgeReplay.RequestID != accepted.RequestID ||
		afterPurgeReplay.StatusToken != accepted.StatusToken ||
		afterPurgeReplay.Status != "completed" {
		t.Fatalf("物理删除后的重放结果不一致：%+v", afterPurgeReplay)
	}
	if len(queue.requests) != 1 {
		t.Fatal("物理删除后的重放不应再次登记 Worker")
	}
	if _, err := svc.Status(ctx, accepted.RequestID, "wrong-token"); err == nil {
		t.Fatal("错误状态凭证不应读取删除进度")
	}
}

func containsObjectKey(keys []string, mediaID string) bool {
	for _, key := range keys {
		if strings.Contains(key, mediaID) {
			return true
		}
	}
	return false
}
