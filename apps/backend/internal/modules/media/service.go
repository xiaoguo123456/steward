// Package media 拥有媒体资产的授权、上传确认与删除。
//
// 二进制内容存放在对象存储，数据库只保存受控引用与元数据。
// 客户端上报的 MIME、扩展名与大小都不可信：上传完成后由服务端回查存储侧的真实值。
package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

const (
	// uploadTTL 是直传授权的有效期。过期后重新申请，但复用同一个 media_id。
	uploadTTL = 15 * time.Minute
	// readTTL 是只读地址的有效期，故意很短：这类地址不允许被缓存或分享。
	readTTL = 5 * time.Minute
)

// Service 是媒体资产的应用服务。
type Service struct {
	db    *database.DB
	store storage.ObjectStore
}

// New 构造 Service。
func New(db *database.DB, store storage.ObjectStore) *Service {
	return &Service{db: db, store: store}
}

// StoreName 返回当前存储适配器名称，供健康检查展示。
func (s *Service) StoreName() string { return s.store.Name() }

// Grant 是一次直传授权的结果。
type Grant struct {
	MediaID  string
	Upload   storage.UploadGrant
	MaxBytes int64
}

// CreateGrants 为每个媒体项分配对象键与直传授权。
func (s *Service) CreateGrants(ctx context.Context, userID string,
	items []httpapi.UploadGrantRequestItem) ([]Grant, error) {

	if len(items) == 0 {
		return nil, apperr.Validation(apperr.Field("items", "至少需要一个媒体项。"))
	}

	// 先在事务外完成全部校验与键生成，事务内只做插入。
	type prepared struct {
		mediaID     string
		key         string
		kind        string
		contentType string
		maxBytes    int64
	}
	plans := make([]prepared, 0, len(items))

	for i, item := range items {
		contentType := strings.ToLower(strings.TrimSpace(item.ContentType))
		if _, err := storage.ExtensionFor(contentType); err != nil {
			return nil, apperr.Validation(apperr.Field(
				fmt.Sprintf("items[%d].content_type", i), err.Error()))
		}

		maxBytes := storage.MaxBytesFor(contentType)
		// 有预估大小时提前拒绝，不用等客户端传完再失败。
		if item.ByteSize != nil && *item.ByteSize > maxBytes {
			return nil, apperr.Validation(apperr.Field(
				fmt.Sprintf("items[%d].byte_size", i),
				fmt.Sprintf("文件超过 %d MB 上限。", maxBytes>>20)))
		}
		if err := checkKindMatchesType(string(item.Kind), contentType); err != nil {
			return nil, apperr.Validation(apperr.Field(
				fmt.Sprintf("items[%d].kind", i), err.Error()))
		}

		mediaID := idgen.New(idgen.PrefixMedia)
		key, err := storage.BuildKey(userID, mediaID, contentType)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		plans = append(plans, prepared{
			mediaID: mediaID, key: key, kind: string(item.Kind),
			contentType: contentType, maxBytes: maxBytes,
		})
	}

	var out []Grant
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, plan := range plans {
			if _, err := q.CreateMediaAsset(ctx, dbgen.CreateMediaAssetParams{
				ID: plan.mediaID, UserID: userID, ObjectKey: plan.key,
				Kind: plan.kind, ContentType: plan.contentType,
			}); err != nil {
				return apperr.Internal(err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 签名不落库也不进事务：它是一次性的传输凭证，随时可以重新生成。
	for _, plan := range plans {
		grant, err := s.store.PresignUpload(ctx, plan.key, plan.contentType, uploadTTL)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		out = append(out, Grant{MediaID: plan.mediaID, Upload: grant, MaxBytes: plan.maxBytes})
	}
	return out, nil
}

// Asset 是媒体资产及其短期只读地址。
type Asset struct {
	Row     dbgen.MediaAsset
	ReadURL string
}

// Get 读取资产状态。
func (s *Service) Get(ctx context.Context, userID, mediaID string) (Asset, error) {
	var out Asset
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetMediaAsset(ctx, mediaID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("媒体文件")
			}
			return apperr.Internal(err)
		}
		out.Row = row
		return nil
	})
	if err != nil {
		return Asset{}, err
	}

	if out.Row.Status == "uploaded" {
		url, err := s.store.PresignRead(ctx, out.Row.ObjectKey, readTTL)
		if err != nil {
			return Asset{}, apperr.Internal(err)
		}
		out.ReadURL = url
	}
	return out, nil
}

// Complete 确认上传完成。
//
// 这里是信任边界：不采信客户端上报的大小与类型，而是回查对象存储的真实元数据。
func (s *Service) Complete(ctx context.Context, userID, mediaID string,
	reported *httpapi.CompleteUploadRequest) (Asset, error) {

	var row dbgen.MediaAsset
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		found, err := q.GetMediaAsset(ctx, mediaID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("媒体文件")
			}
			return apperr.Internal(err)
		}
		row = found
		return nil
	})
	if err != nil {
		return Asset{}, err
	}

	// 重复确认是幂等的：已经完成的资产直接返回当前状态。
	if row.Status == "uploaded" {
		return s.Get(ctx, userID, mediaID)
	}
	// 对象键必须落在该用户的前缀下，防止越权确认他人对象。
	if !storage.KeyBelongsTo(row.ObjectKey, userID) {
		return Asset{}, apperr.New(apperr.CodePermissionDenied)
	}

	// 事务外回查存储侧，避免网络往返占着数据库连接。
	asset, statErr := s.store.Stat(ctx, row.ObjectKey)
	if statErr != nil {
		body, _ := json.Marshal(map[string]any{
			"code":    string(apperr.CodeValidationFailed),
			"message": "没有找到已上传的文件，请重新上传。",
		})
		_ = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
			return q.MarkMediaFailed(ctx, dbgen.MarkMediaFailedParams{ID: mediaID, Error: body})
		})
		return Asset{}, apperr.Newf(apperr.CodeValidationFailed, "没有找到已上传的文件，请重新上传。")
	}

	maxBytes := storage.MaxBytesFor(row.ContentType)
	if asset.Size > maxBytes {
		// 超限文件立即删除，不留在存储里占空间。
		_ = s.store.Delete(ctx, row.ObjectKey)
		body, _ := json.Marshal(map[string]any{
			"code":    string(apperr.CodeValidationFailed),
			"message": "文件超过大小上限。",
		})
		_ = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
			return q.MarkMediaFailed(ctx, dbgen.MarkMediaFailedParams{ID: mediaID, Error: body})
		})
		return Asset{}, apperr.Newf(apperr.CodeValidationFailed,
			"文件超过 %d MB 上限。", maxBytes>>20)
	}
	if asset.Size == 0 {
		return Asset{}, apperr.Newf(apperr.CodeValidationFailed, "文件内容为空，请重新上传。")
	}
	// 客户端上报的大小与存储侧不一致，通常意味着上传中途被打断。
	// 以存储侧为准，同时拒绝这次确认，让客户端重传而不是拿到半个文件。
	if reported != nil && reported.ByteSize != nil && *reported.ByteSize != asset.Size {
		return Asset{}, apperr.Newf(apperr.CodeValidationFailed,
			"上传似乎没有完成，请重新上传这个文件。")
	}

	// ETag 在非分片上传时就是内容的 MD5，可作为去重指纹；
	// 客户端上报的 content_hash 只用于比对，不写入权威字段。
	var contentHash *string
	if asset.ETag != "" {
		hash := asset.ETag
		contentHash = &hash
	}
	var contentType *string
	if asset.ContentType != "" {
		ct := asset.ContentType
		contentType = &ct
	}

	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		updated, err := q.MarkMediaUploaded(ctx, dbgen.MarkMediaUploadedParams{
			ID:          mediaID,
			ByteSize:    &asset.Size,
			ContentHash: contentHash,
			ContentType: contentType,
		})
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("媒体文件")
			}
			return apperr.Internal(err)
		}
		row = updated
		return nil
	})
	if err != nil {
		return Asset{}, err
	}

	readURL, err := s.store.PresignRead(ctx, row.ObjectKey, readTTL)
	if err != nil {
		return Asset{}, apperr.Internal(err)
	}
	return Asset{Row: row, ReadURL: readURL}, nil
}

// Delete 删除媒体资产。
//
// 先标记不可读取再清理存储：用户不会在对象实际删除前继续访问原文件。
func (s *Service) Delete(ctx context.Context, userID, mediaID string) error {
	var row dbgen.MediaAsset
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		deleted, err := q.SoftDeleteMediaAsset(ctx, mediaID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("媒体文件")
			}
			return apperr.Internal(err)
		}
		row = deleted
		return nil
	})
	if err != nil {
		return err
	}

	// 存储清理失败不回滚数据库：资产已经对用户不可见，
	// 残留对象由保留任务重试清理，比让删除动作整体失败更符合预期。
	if err := s.store.Delete(ctx, row.ObjectKey); err != nil {
		return nil
	}
	return nil
}

// ResolveForParse 供 Capture 解析读取已上传媒体的内容。
//
// 它会校验资产属于当前用户且已完成上传，避免 Worker 读到未就绪或他人的对象。
func (s *Service) ResolveForParse(ctx context.Context, userID, mediaID string) (dbgen.MediaAsset, error) {
	var row dbgen.MediaAsset
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		found, err := q.GetMediaAsset(ctx, mediaID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("媒体文件")
			}
			return apperr.Internal(err)
		}
		if found.Status != "uploaded" {
			return apperr.New(apperr.CodeCaptureNotReady)
		}
		row = found
		return nil
	})
	return row, err
}

// ReadURL 生成短期只读地址，供 Vision Provider 拉取图片。
func (s *Service) ReadURL(ctx context.Context, objectKey string) (string, error) {
	return s.store.PresignRead(ctx, objectKey, readTTL)
}

// checkKindMatchesType 校验声明的类型与 MIME 是否一致。
func checkKindMatchesType(kind, contentType string) error {
	switch kind {
	case "image":
		if !strings.HasPrefix(contentType, "image/") {
			return fmt.Errorf("kind=image 需要 image/* 类型")
		}
	case "audio":
		if !strings.HasPrefix(contentType, "audio/") {
			return fmt.Errorf("kind=audio 需要 audio/* 类型")
		}
	default:
		return fmt.Errorf("不支持的媒体类型 %q", kind)
	}
	return nil
}

// ReadBytes 读取对象内容到内存，供 Worker 做 OCR 与转写。
//
// 大小上限在上传阶段已经保证，这里再挡一次，防止存储侧被绕过写入超大对象。
func (s *Service) ReadBytes(ctx context.Context, objectKey string, limit int64) ([]byte, error) {
	reader, err := s.store.Open(ctx, objectKey)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return nil, apperr.NotFound("媒体文件")
		}
		return nil, apperr.Internal(err)
	}
	defer reader.Close()

	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if int64(len(data)) > limit {
		return nil, apperr.Newf(apperr.CodeValidationFailed, "文件超过处理上限。")
	}
	return data, nil
}
