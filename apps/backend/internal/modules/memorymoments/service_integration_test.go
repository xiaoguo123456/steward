package memorymoments_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/media"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/memorymoments"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

type memoryStore struct {
	mu       sync.Mutex
	deleted  []string
	failures int
}

type memoryDeletionQueue struct {
	args []memorymoments.MediaDeletionArgs
}

func (q *memoryDeletionQueue) EnqueueMemoryMomentMediaDeletion(
	_ context.Context, _ *dbgen.Queries, args memorymoments.MediaDeletionArgs,
) error {
	q.args = append(q.args, args)
	return nil
}

func (*memoryStore) Name() string { return "memory-test" }
func (*memoryStore) PresignUpload(_ context.Context, key, contentType string, ttl time.Duration) (storage.UploadGrant, error) {
	return storage.UploadGrant{Key: key, URL: "https://upload.invalid", Method: "PUT",
		Headers: map[string]string{"Content-Type": contentType}, ExpiresAt: time.Now().Add(ttl)}, nil
}
func (*memoryStore) PresignRead(_ context.Context, key string, _ time.Duration) (string, error) {
	return "https://read.invalid/" + key, nil
}
func (*memoryStore) Stat(context.Context, string) (storage.Asset, error) {
	return storage.Asset{}, storage.ErrNotFound
}
func (*memoryStore) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (s *memoryStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failures > 0 {
		s.failures--
		return errors.New("临时对象存储错误")
	}
	s.deleted = append(s.deleted, key)
	return nil
}

func TestPublishedMemoryMomentIsUserIsolatedIdempotentAndDeleteOnly(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过时光集成测试")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userA := createTestUser(t, ctx, db, "时光测试甲")
	userB := createTestUser(t, ctx, db, "时光测试乙")
	t.Cleanup(func() {
		deleteTestUser(context.Background(), db, userA)
		deleteTestUser(context.Background(), db, userB)
	})

	mediaID := idgen.New(idgen.PrefixMedia)
	objectKey, err := storage.BuildKey(userA, mediaID, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	err = db.InTx(ctx, userA, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateMediaAsset(ctx, dbgen.CreateMediaAssetParams{
			ID: mediaID, UserID: userA, ObjectKey: objectKey,
			Kind: "image", ContentType: "image/jpeg",
		}); err != nil {
			return err
		}
		size := int64(1024)
		_, err := q.MarkMediaUploaded(ctx, dbgen.MarkMediaUploadedParams{
			ID: mediaID, ByteSize: &size,
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备媒体失败：%v", err)
	}

	store := &memoryStore{}
	mediaSvc := media.New(db, store)
	deletionQueue := &memoryDeletionQueue{}
	svc := memorymoments.New(db, mediaSvc, activity.New(db), deletionQueue)
	description := "傍晚的风很轻。"
	body := httpapi.CreateMemoryMomentRequest{
		Description: &description,
		Photos:      []httpapi.MemoryMomentPhotoInput{{MediaId: mediaID}},
	}
	first, err := svc.Create(ctx, userA, "memory-create-key", body)
	if err != nil {
		t.Fatalf("发布时光失败：%v", err)
	}
	replayed, err := svc.Create(ctx, userA, "memory-create-key", body)
	if err != nil || replayed.Row.ID != first.Row.ID {
		t.Fatalf("同键重放没有返回同一时光：%v, %s/%s", err, first.Row.ID, replayed.Row.ID)
	}
	if len(first.Photos) != 1 || !strings.HasPrefix(first.Photos[0].ReadURL, "https://read.invalid/") {
		t.Fatalf("没有生成私有读取地址：%+v", first.Photos)
	}
	if first.Row.Description != description {
		t.Fatalf("描述没有保存：%q", first.Row.Description)
	}
	expectedDate := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	if first.Row.OccurredOn.Format("2006-01-02") != expectedDate {
		t.Fatalf("发布日期没有按账号时区生成：%s", first.Row.OccurredOn)
	}

	_, err = svc.Get(ctx, userB, first.Row.ID)
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeNotFound {
		t.Fatalf("另一用户读取应表现为不存在，实际：%v", err)
	}
	_, err = svc.Delete(ctx, userB, first.Row.ID, "memory-other-user-delete-key")
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeNotFound {
		t.Fatalf("另一用户删除应表现为不存在，实际：%v", err)
	}
	otherRows, err := svc.List(ctx, userB, memorymoments.Filter{Limit: 20})
	if err != nil || len(otherRows) != 0 {
		t.Fatalf("另一用户列表不应泄露时光：%v, %+v", err, otherRows)
	}
	if err := mediaSvc.Delete(ctx, userA, mediaID); !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeVersionConflict {
		t.Fatalf("活动时光引用的媒体不应被单独删除，实际：%v", err)
	}

	batchID, err := svc.Delete(ctx, userA, first.Row.ID, "memory-delete-key")
	if err != nil {
		t.Fatalf("删除时光失败：%v", err)
	}
	replayedBatchID, err := svc.Delete(ctx, userA, first.Row.ID, "memory-delete-key")
	if err != nil || replayedBatchID != batchID {
		t.Fatalf("删除重放没有保持成功：%v, %s/%s", err, batchID, replayedBatchID)
	}
	if _, err := svc.Get(ctx, userA, first.Row.ID); !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeNotFound {
		t.Fatalf("删除后的时光仍可读取：%v", err)
	}
	if len(deletionQueue.args) != 1 {
		t.Fatalf("删除重放不应重复登记媒体清理，实际 %d", len(deletionQueue.args))
	}
	store.mu.Lock()
	store.failures = 1
	store.mu.Unlock()
	if err := mediaSvc.PurgeDeleted(ctx, deletionQueue.args[0].UserID, deletionQueue.args[0].MediaID); err == nil {
		t.Fatal("对象存储临时失败时应让清理任务重试")
	}
	if err := mediaSvc.PurgeDeleted(ctx, deletionQueue.args[0].UserID, deletionQueue.args[0].MediaID); err != nil {
		t.Fatalf("重试媒体物理清理失败：%v", err)
	}
	store.mu.Lock()
	deletedCount := len(store.deleted)
	store.mu.Unlock()
	if deletedCount != 1 {
		t.Fatalf("媒体副本应只清理一次，实际 %d", deletedCount)
	}
}

func createTestUser(t *testing.T, ctx context.Context, db *database.DB, name string) string {
	t.Helper()
	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("195%08d", time.Now().UnixNano()%100000000)
	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, name, "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	return userID
}

func deleteTestUser(ctx context.Context, db *database.DB, userID string) {
	_ = db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
		return err
	})
}
