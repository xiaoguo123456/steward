// Package storage 定义对象存储的窄接口。
//
// 业务模块只依赖这里的 ObjectStore，不导入任何厂商 SDK；
// 更换存储厂商时只需要新增一个适配器，业务代码不改动。
//
// 安全约束（来自整体架构设计 20.7 与 10.3）：
//   - 对象默认私有，只通过短期签名 URL 上传或读取。
//   - App 只能上传到服务端分配的用户隔离路径。
//   - 后端不信任客户端上报的 MIME、扩展名与大小，落库前必须回查真实元数据。
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
)

// ErrNotFound 表示对象不存在。
var ErrNotFound = errors.New("对象不存在")

// Asset 是对象的真实元数据，由服务端从存储侧回查得到。
type Asset struct {
	Key         string
	Size        int64
	ContentType string
	ETag        string
}

// UploadGrant 是一次客户端直传授权。
//
// 客户端只需要按 Method 向 URL 发送字节并带上 Headers，
// 不关心背后是阿里云 OSS 还是本地文件系统。
type UploadGrant struct {
	Key       string
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

// ObjectStore 是对象存储的窄接口。
type ObjectStore interface {
	// Name 返回适配器名称，用于健康检查与审计展示。
	Name() string

	// PresignUpload 生成短期直传授权。
	// 大文件直传存储，不经过 API 进程，避免连接与内存被占满。
	PresignUpload(ctx context.Context, key, contentType string, ttl time.Duration) (UploadGrant, error)

	// PresignRead 生成短期只读地址。返回的 URL 不得写入日志或幂等响应快照。
	PresignRead(ctx context.Context, key string, ttl time.Duration) (string, error)

	// Stat 回查对象真实元数据，用于校验客户端上报的大小与类型。
	Stat(ctx context.Context, key string) (Asset, error)

	// Open 读取对象内容，供 Worker 做转写与 OCR。
	Open(ctx context.Context, key string) (io.ReadCloser, error)

	// Delete 删除对象。实现必须清理全部版本与残留分片。
	Delete(ctx context.Context, key string) error
}

// 上传约束。超出时直接拒绝，不把校验推迟到存储侧。
const (
	MaxImageBytes = 20 << 20 // 20 MiB
	MaxAudioBytes = 50 << 20 // 50 MiB
)

// allowedContentTypes 是允许上传的类型白名单。
//
// 客户端上报的 MIME 不可信，这里只用于早期拒绝；
// 真实类型仍需在上传完成后由服务端回查并按内容嗅探确认。
var allowedContentTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/heic": ".heic",
	"audio/m4a":  ".m4a",
	"audio/mp4":  ".m4a",
	"audio/mpeg": ".mp3",
	"audio/wav":  ".wav",
	"audio/webm": ".webm",
}

// ExtensionFor 返回内容类型对应的扩展名，不受支持时返回错误。
func ExtensionFor(contentType string) (string, error) {
	ext, ok := allowedContentTypes[strings.ToLower(strings.TrimSpace(contentType))]
	if !ok {
		return "", fmt.Errorf("不支持的文件类型 %q", contentType)
	}
	return ext, nil
}

// MaxBytesFor 返回该类型允许的最大字节数。
func MaxBytesFor(contentType string) int64 {
	if strings.HasPrefix(contentType, "audio/") {
		return MaxAudioBytes
	}
	return MaxImageBytes
}

// BuildKey 生成用户隔离的对象键。
//
// 路径里带上 user_id 是硬隔离的一部分：即使签名被泄漏，
// 也只能命中该用户自己的前缀，无法越权写入他人目录。
func BuildKey(userID, mediaID, contentType string) (string, error) {
	ext, err := ExtensionFor(contentType)
	if err != nil {
		return "", err
	}
	if userID == "" || mediaID == "" {
		return "", errors.New("生成对象键需要用户与媒体 ID")
	}
	return path.Join("users", userID, "media", mediaID+ext), nil
}

// KeyBelongsTo 校验对象键属于指定用户。
// 任何按 key 操作的入口都必须先过这一关，不能只信数据库里的关联。
func KeyBelongsTo(key, userID string) bool {
	return strings.HasPrefix(key, path.Join("users", userID)+"/")
}
