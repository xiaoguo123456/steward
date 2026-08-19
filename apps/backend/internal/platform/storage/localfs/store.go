// Package localfs 是本地文件系统的 ObjectStore 适配器，只用于开发与测试。
//
// 它让「申请授权 → 直传 → 回查元数据 → 提交」这条链路在没有任何云凭证时
// 也能完整跑通：签名 URL 指向 API 自身的一个传输端点，客户端代码与生产完全一致。
//
// 它不适用于生产：没有冗余、没有服务端加密、也不做跨进程并发控制。
package localfs

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

// Config 是适配器配置。
type Config struct {
	// Root 是对象落盘的根目录。
	Root string
	// BaseURL 是 API 对外可达的地址，签名 URL 以它为前缀。
	BaseURL string
	// Secret 用于签名传输 URL，与 JWT 密钥独立用途。
	Secret string
}

// Store 实现 storage.ObjectStore。
type Store struct {
	root    string
	baseURL string
	secret  []byte
}

// TransportPrefix 是本地传输端点的路径前缀。
// 它属于存储传输细节，不是产品 API，因此不登记到 OpenAPI 契约。
const TransportPrefix = "/media/local/"

// New 构造适配器。
func New(cfg Config) (*Store, error) {
	if cfg.Root == "" {
		return nil, errors.New("必须配置 STEWARD_STORAGE_ROOT")
	}
	if cfg.Secret == "" {
		return nil, errors.New("本地存储需要签名密钥")
	}
	if err := os.MkdirAll(cfg.Root, 0o755); err != nil {
		return nil, fmt.Errorf("创建存储目录失败：%w", err)
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		base = "http://localhost:8787"
	}
	return &Store{root: cfg.Root, baseURL: base, secret: []byte(cfg.Secret)}, nil
}

// Name 返回适配器名称。
func (s *Store) Name() string { return "localfs" }

// PresignUpload 生成指向本地传输端点的上传授权。
func (s *Store) PresignUpload(_ context.Context, key, contentType string, ttl time.Duration) (storage.UploadGrant, error) {
	expires := time.Now().Add(ttl)
	return storage.UploadGrant{
		Key:       key,
		URL:       s.signedURL(key, "PUT", expires),
		Method:    "PUT",
		Headers:   map[string]string{"Content-Type": contentType},
		ExpiresAt: expires,
	}, nil
}

// PresignRead 生成指向本地传输端点的只读地址。
func (s *Store) PresignRead(_ context.Context, key string, ttl time.Duration) (string, error) {
	return s.signedURL(key, "GET", time.Now().Add(ttl)), nil
}

// Stat 读取本地文件元数据。
func (s *Store) Stat(_ context.Context, key string) (storage.Asset, error) {
	path, err := s.resolve(key)
	if err != nil {
		return storage.Asset{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return storage.Asset{}, storage.ErrNotFound
		}
		return storage.Asset{}, err
	}
	// 本地适配器不单独保存 Content-Type，由调用方按扩展名与内容嗅探判断。
	return storage.Asset{Key: key, Size: info.Size()}, nil
}

// Open 读取本地文件内容。
func (s *Store) Open(_ context.Context, key string) (io.ReadCloser, error) {
	path, err := s.resolve(key)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, storage.ErrNotFound
		}
		return nil, err
	}
	return file, nil
}

// Delete 删除本地文件。
func (s *Store) Delete(_ context.Context, key string) error {
	path, err := s.resolve(key)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Write 由传输端点在收到 PUT 时调用。
func (s *Store) Write(key string, body io.Reader, limit int64) (int64, error) {
	path, err := s.resolve(key)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	file, err := os.Create(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	// 超过上限时截断并报错，避免磁盘被写满。
	written, err := io.Copy(file, io.LimitReader(body, limit+1))
	if err != nil {
		return 0, err
	}
	if written > limit {
		_ = os.Remove(path)
		return 0, fmt.Errorf("内容超过 %d 字节上限", limit)
	}
	return written, nil
}

// VerifySignature 校验传输 URL 的签名与有效期。
func (s *Store) VerifySignature(key, method, expires, signature string) error {
	unix, err := strconv.ParseInt(expires, 10, 64)
	if err != nil {
		return errors.New("签名参数不合法")
	}
	if time.Now().After(time.Unix(unix, 0)) {
		return errors.New("签名已过期")
	}
	expected := s.sign(key, method, unix)
	// 恒定时间比较，避免通过响应时间逐字节猜测签名。
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return errors.New("签名不匹配")
	}
	return nil
}

func (s *Store) signedURL(key, method string, expires time.Time) string {
	unix := expires.Unix()
	query := url.Values{}
	query.Set("exp", strconv.FormatInt(unix, 10))
	query.Set("sig", s.sign(key, method, unix))
	return fmt.Sprintf("%s%s%s?%s", s.baseURL, TransportPrefix, key, query.Encode())
}

func (s *Store) sign(key, method string, expires int64) string {
	mac := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(mac, "%s\n%s\n%d", method, key, expires)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// resolve 把对象键映射成本地路径，并阻断路径穿越。
func (s *Store) resolve(key string) (string, error) {
	if key == "" || strings.Contains(key, "..") {
		return "", errors.New("对象键不合法")
	}
	// 用哈希后的层级目录避免单目录文件过多，同时保留原 key 的可读前缀。
	clean := filepath.Clean(filepath.FromSlash(key))
	if filepath.IsAbs(clean) {
		return "", errors.New("对象键不能是绝对路径")
	}
	full := filepath.Join(s.root, clean)
	rel, err := filepath.Rel(s.root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", errors.New("对象键超出存储根目录")
	}
	return full, nil
}
