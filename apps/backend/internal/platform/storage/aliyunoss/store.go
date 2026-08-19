// Package aliyunoss 是阿里云 OSS 的 ObjectStore 适配器。
//
// 厂商 SDK 只允许出现在本包内：业务模块看到的始终是 storage.ObjectStore。
//
// Bucket 必须是私有读写：所有访问都通过短期签名 URL，
// 不允许配置公共读，也不允许把长期 AccessKey 下发给客户端。
package aliyunoss

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

// Config 是适配器配置。
type Config struct {
	// Endpoint 例如 oss-cn-hangzhou.aliyuncs.com。
	Endpoint string
	Region   string
	Bucket   string
	// AccessKeyID 与 AccessKeySecret 只存在于服务端，不下发给客户端。
	AccessKeyID     string
	AccessKeySecret string
}

// Store 实现 storage.ObjectStore。
type Store struct {
	client *oss.Client
	bucket string
}

// New 构造适配器。
func New(cfg Config) (*Store, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("必须配置 STEWARD_OSS_BUCKET")
	}
	if cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" {
		return nil, errors.New("必须配置 STEWARD_OSS_ACCESS_KEY_ID 与 STEWARD_OSS_ACCESS_KEY_SECRET")
	}
	if cfg.Region == "" {
		return nil, errors.New("必须配置 STEWARD_OSS_REGION，例如 cn-hangzhou")
	}

	provider := credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.AccessKeySecret)
	options := oss.LoadDefaultConfig().
		WithCredentialsProvider(provider).
		WithRegion(cfg.Region)
	if cfg.Endpoint != "" {
		options = options.WithEndpoint(cfg.Endpoint)
	}

	return &Store{client: oss.NewClient(options), bucket: cfg.Bucket}, nil
}

// Name 返回适配器名称。
func (s *Store) Name() string { return "aliyun-oss" }

// PresignUpload 生成 PUT 直传授权。
//
// Content-Type 参与签名：客户端上传时必须带上同一个值，
// 否则签名不匹配，无法把图片伪装成其他类型绕过后续校验。
func (s *Store) PresignUpload(ctx context.Context, key, contentType string, ttl time.Duration) (storage.UploadGrant, error) {
	result, err := s.client.Presign(ctx, &oss.PutObjectRequest{
		Bucket:      oss.Ptr(s.bucket),
		Key:         oss.Ptr(key),
		ContentType: oss.Ptr(contentType),
	}, oss.PresignExpires(ttl))
	if err != nil {
		return storage.UploadGrant{}, fmt.Errorf("生成上传授权失败：%w", err)
	}

	headers := map[string]string{"Content-Type": contentType}
	for name, value := range result.SignedHeaders {
		headers[name] = value
	}

	return storage.UploadGrant{
		Key:       key,
		URL:       result.URL,
		Method:    result.Method,
		Headers:   headers,
		ExpiresAt: result.Expiration,
	}, nil
}

// PresignRead 生成短期只读地址。
func (s *Store) PresignRead(ctx context.Context, key string, ttl time.Duration) (string, error) {
	result, err := s.client.Presign(ctx, &oss.GetObjectRequest{
		Bucket: oss.Ptr(s.bucket),
		Key:    oss.Ptr(key),
	}, oss.PresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("生成读取地址失败：%w", err)
	}
	return result.URL, nil
}

// Stat 回查对象真实元数据。
func (s *Store) Stat(ctx context.Context, key string) (storage.Asset, error) {
	result, err := s.client.HeadObject(ctx, &oss.HeadObjectRequest{
		Bucket: oss.Ptr(s.bucket),
		Key:    oss.Ptr(key),
	})
	if err != nil {
		if isNotFound(err) {
			return storage.Asset{}, storage.ErrNotFound
		}
		return storage.Asset{}, fmt.Errorf("读取对象元数据失败：%w", err)
	}

	asset := storage.Asset{Key: key, Size: result.ContentLength}
	if result.ContentType != nil {
		asset.ContentType = *result.ContentType
	}
	if result.ETag != nil {
		asset.ETag = strings.Trim(*result.ETag, `"`)
	}
	return asset, nil
}

// Open 读取对象内容。
func (s *Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	result, err := s.client.GetObject(ctx, &oss.GetObjectRequest{
		Bucket: oss.Ptr(s.bucket),
		Key:    oss.Ptr(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, storage.ErrNotFound
		}
		return nil, fmt.Errorf("读取对象失败：%w", err)
	}
	return result.Body, nil
}

// Delete 删除对象。
//
// Bucket 开启版本控制时，DeleteObject 只会写一个删除标记；
// 因此这里显式列出并删除该 key 的全部版本，保证“删除后不可恢复”。
func (s *Store) Delete(ctx context.Context, key string) error {
	paginator := s.client.NewListObjectVersionsPaginator(&oss.ListObjectVersionsRequest{
		Bucket: oss.Ptr(s.bucket),
		Prefix: oss.Ptr(key),
	})

	deletedAny := false
	for paginator.HasNext() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("列出对象版本失败：%w", err)
		}
		for _, version := range page.ObjectVersions {
			if version.Key == nil || *version.Key != key {
				continue
			}
			if _, err := s.client.DeleteObject(ctx, &oss.DeleteObjectRequest{
				Bucket:    oss.Ptr(s.bucket),
				Key:       oss.Ptr(key),
				VersionId: version.VersionId,
			}); err != nil {
				return fmt.Errorf("删除对象版本失败：%w", err)
			}
			deletedAny = true
		}
		for _, marker := range page.ObjectDeleteMarkers {
			if marker.Key == nil || *marker.Key != key {
				continue
			}
			if _, err := s.client.DeleteObject(ctx, &oss.DeleteObjectRequest{
				Bucket:    oss.Ptr(s.bucket),
				Key:       oss.Ptr(key),
				VersionId: marker.VersionId,
			}); err != nil {
				return fmt.Errorf("删除对象删除标记失败：%w", err)
			}
			deletedAny = true
		}
	}

	// 未开启版本控制时上面不会返回任何版本，走普通删除。
	if !deletedAny {
		if _, err := s.client.DeleteObject(ctx, &oss.DeleteObjectRequest{
			Bucket: oss.Ptr(s.bucket),
			Key:    oss.Ptr(key),
		}); err != nil && !isNotFound(err) {
			return fmt.Errorf("删除对象失败：%w", err)
		}
	}
	return nil
}

func isNotFound(err error) bool {
	var serviceErr *oss.ServiceError
	if errors.As(err, &serviceErr) {
		return serviceErr.StatusCode == 404
	}
	return false
}
