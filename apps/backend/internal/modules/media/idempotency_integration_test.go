package media_test

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
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/media"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

type grantStore struct {
	mu    sync.Mutex
	count int
}

func (*grantStore) Name() string { return "test" }
func (s *grantStore) PresignUpload(_ context.Context, key, _ string, ttl time.Duration) (storage.UploadGrant, error) {
	s.mu.Lock()
	s.count++
	count := s.count
	s.mu.Unlock()
	return storage.UploadGrant{Key: key, URL: fmt.Sprintf("https://upload.invalid/%d", count),
		Method: "PUT", ExpiresAt: time.Now().Add(ttl)}, nil
}
func (*grantStore) PresignRead(context.Context, string, time.Duration) (string, error) {
	return "", nil
}
func (*grantStore) Stat(context.Context, string) (storage.Asset, error) {
	return storage.Asset{}, storage.ErrNotFound
}
func (*grantStore) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}
func (*grantStore) Delete(context.Context, string) error { return nil }

func TestCreateUploadGrantsIsIdempotentAndRegeneratesSignedURL(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过媒体授权幂等集成测试")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("196%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "媒体幂等测试用户", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建用户失败：%v", err)
	}

	store := &grantStore{}
	svc := media.New(db, store)
	items := []httpapi.UploadGrantRequestItem{{Kind: httpapi.MediaKindImage, ContentType: "image/jpeg"}}
	first, err := svc.CreateGrants(ctx, userID, "grant-key", items)
	if err != nil {
		t.Fatalf("首次创建授权失败：%v", err)
	}
	second, err := svc.CreateGrants(ctx, userID, "grant-key", items)
	if err != nil {
		t.Fatalf("同键重放失败：%v", err)
	}
	if first[0].MediaID != second[0].MediaID {
		t.Fatal("同键重放产生了不同 media_id")
	}
	if first[0].Upload.URL == second[0].Upload.URL {
		t.Fatal("重放应按需生成新签名地址，不能持久化旧签名")
	}

	different := []httpapi.UploadGrantRequestItem{{Kind: httpapi.MediaKindAudio, ContentType: "audio/m4a"}}
	_, err = svc.CreateGrants(ctx, userID, "grant-key", different)
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeIdempotencyReused {
		t.Fatalf("同键不同请求体应被拒绝，实际：%v", err)
	}
}
