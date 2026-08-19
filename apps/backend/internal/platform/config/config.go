// Package config 负责从环境变量加载运行配置。
// 所有默认值只适用于本地开发；生产环境必须显式提供。
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config 保存进程启动所需的全部配置。
type Config struct {
	HTTPAddr    string
	CORSOrigins []string
	// PublicBaseURL 是 API 对外可达的地址，本地存储用它生成签名 URL。
	PublicBaseURL string

	DatabaseURL string

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	DevSMSCode      string

	AI      AIConfig
	Storage StorageConfig
}

// AIConfig 是模型 Provider 配置。
//
// 业务代码只引用逻辑用途（解析、视觉、转写），具体模型名在这里配置，
// 换模型不需要改动任何业务模块。
type AIConfig struct {
	// Provider 取 fake 或 openai。
	Provider string
	BaseURL  string
	APIKey   string

	ModelParse      string
	ModelVision     string
	ModelTranscribe string

	Timeout         time.Duration
	MaxOutputTokens int
}

// StorageConfig 是对象存储配置。
type StorageConfig struct {
	// Driver 取 localfs 或 aliyun-oss。
	Driver string
	Root   string

	OSSRegion          string
	OSSEndpoint        string
	OSSBucket          string
	OSSAccessKeyID     string
	OSSAccessKeySecret string
}

// Load 读取 .env（如果存在）与进程环境变量，并校验必填项。
func Load() (Config, error) {
	// .env 只在本地存在；缺失不是错误。
	_ = godotenv.Load(findEnvFile()...)

	cfg := Config{
		HTTPAddr:      env("STEWARD_HTTP_ADDR", ":8787"),
		CORSOrigins:   splitAndTrim(env("STEWARD_CORS_ORIGINS", "http://localhost:8081,http://localhost:4174")),
		PublicBaseURL: env("STEWARD_PUBLIC_BASE_URL", "http://localhost:8787"),
		DatabaseURL:   env("STEWARD_DATABASE_URL", ""),
		JWTSecret:     env("STEWARD_JWT_SECRET", ""),
		DevSMSCode:    env("STEWARD_DEV_SMS_CODE", ""),
		AI: AIConfig{
			Provider:        env("STEWARD_AI_PROVIDER", "fake"),
			BaseURL:         strings.TrimRight(env("STEWARD_AI_BASE_URL", ""), "/"),
			APIKey:          env("STEWARD_AI_API_KEY", ""),
			ModelParse:      env("STEWARD_AI_MODEL_PARSE", ""),
			ModelVision:     env("STEWARD_AI_MODEL_VISION", ""),
			ModelTranscribe: env("STEWARD_AI_MODEL_TRANSCRIBE", ""),
			MaxOutputTokens: envInt("STEWARD_AI_MAX_OUTPUT_TOKENS", 2048),
		},
		Storage: StorageConfig{
			Driver:             env("STEWARD_STORAGE_DRIVER", "localfs"),
			Root:               env("STEWARD_STORAGE_ROOT", "./.local/storage"),
			OSSRegion:          env("STEWARD_OSS_REGION", ""),
			OSSEndpoint:        env("STEWARD_OSS_ENDPOINT", ""),
			OSSBucket:          env("STEWARD_OSS_BUCKET", ""),
			OSSAccessKeyID:     env("STEWARD_OSS_ACCESS_KEY_ID", ""),
			OSSAccessKeySecret: env("STEWARD_OSS_ACCESS_KEY_SECRET", ""),
		},
	}

	var err error
	if cfg.AccessTokenTTL, err = duration("STEWARD_ACCESS_TOKEN_TTL", 2*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.RefreshTokenTTL, err = duration("STEWARD_REFRESH_TOKEN_TTL", 30*24*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.AI.Timeout, err = duration("STEWARD_AI_TIMEOUT", 45*time.Second); err != nil {
		return Config{}, err
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("必须设置 STEWARD_DATABASE_URL")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("必须设置 STEWARD_JWT_SECRET")
	}

	if err := cfg.AI.validate(); err != nil {
		return Config{}, err
	}
	if err := cfg.Storage.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validate 检查 Provider 配置的完整性。
//
// 宁可启动失败也不要带着半套配置跑起来：那样第一次真实调用才会暴露问题，
// 而那时用户已经在等一个永远不会成功的解析。
func (c AIConfig) validate() error {
	switch c.Provider {
	case "", "fake":
		return nil
	case "openai":
		if c.APIKey == "" {
			return errors.New("STEWARD_AI_PROVIDER=openai 时必须设置 STEWARD_AI_API_KEY")
		}
		if c.BaseURL == "" {
			return errors.New("STEWARD_AI_PROVIDER=openai 时必须设置 STEWARD_AI_BASE_URL")
		}
		if c.ModelParse == "" {
			return errors.New("STEWARD_AI_PROVIDER=openai 时必须设置 STEWARD_AI_MODEL_PARSE")
		}
		return nil
	default:
		return fmt.Errorf("不支持的 STEWARD_AI_PROVIDER=%s，可选 fake 或 openai", c.Provider)
	}
}

func (c StorageConfig) validate() error {
	switch c.Driver {
	case "", "localfs":
		return nil
	case "aliyun-oss":
		missing := make([]string, 0, 4)
		if c.OSSBucket == "" {
			missing = append(missing, "STEWARD_OSS_BUCKET")
		}
		if c.OSSRegion == "" {
			missing = append(missing, "STEWARD_OSS_REGION")
		}
		if c.OSSAccessKeyID == "" {
			missing = append(missing, "STEWARD_OSS_ACCESS_KEY_ID")
		}
		if c.OSSAccessKeySecret == "" {
			missing = append(missing, "STEWARD_OSS_ACCESS_KEY_SECRET")
		}
		if len(missing) > 0 {
			return fmt.Errorf("STEWARD_STORAGE_DRIVER=aliyun-oss 时必须设置：%s",
				strings.Join(missing, "、"))
		}
		return nil
	default:
		return fmt.Errorf("不支持的 STEWARD_STORAGE_DRIVER=%s，可选 localfs 或 aliyun-oss", c.Driver)
	}
}

// LoadForTest 返回指向测试库的配置，缺少测试库地址时返回空字符串由调用方跳过。
func LoadForTest() Config {
	_ = godotenv.Load(findEnvFile()...)
	return Config{
		DatabaseURL:     os.Getenv("STEWARD_TEST_DATABASE_URL"),
		JWTSecret:       "test-secret",
		AccessTokenTTL:  time.Hour,
		RefreshTokenTTL: time.Hour,
		DevSMSCode:      "123456",
		AI:              AIConfig{Provider: "fake"},
		Storage:         StorageConfig{Driver: "localfs", Root: os.TempDir() + "/steward-test-storage"},
	}
}

// findEnvFile 依次向上查找仓库根目录的 .env，便于从 apps/backend 子目录启动。
func findEnvFile() []string {
	candidates := []string{".env", "../../.env", "../.env"}
	found := make([]string, 0, 1)
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			found = append(found, c)
			break
		}
	}
	return found
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

func duration(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s 不是合法的时间长度：%w", key, err)
	}
	return d, nil
}

func splitAndTrim(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
