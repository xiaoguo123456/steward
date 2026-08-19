// Package config 负责从环境变量加载运行配置。
// 所有默认值只适用于本地开发；生产环境必须显式提供。
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config 保存进程启动所需的全部配置。
type Config struct {
	HTTPAddr    string
	CORSOrigins []string

	DatabaseURL string

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	DevSMSCode      string

	AIProvider    string
	OpenAIAPIKey  string
	OpenAIBaseURL string

	StorageDriver string
	StorageRoot   string
}

// Load 读取 .env（如果存在）与进程环境变量，并校验必填项。
func Load() (Config, error) {
	// .env 只在本地存在；缺失不是错误。
	_ = godotenv.Load(findEnvFile()...)

	cfg := Config{
		HTTPAddr:      env("STEWARD_HTTP_ADDR", ":8787"),
		CORSOrigins:   splitAndTrim(env("STEWARD_CORS_ORIGINS", "http://localhost:8081,http://localhost:4174")),
		DatabaseURL:   env("STEWARD_DATABASE_URL", ""),
		JWTSecret:     env("STEWARD_JWT_SECRET", ""),
		DevSMSCode:    env("STEWARD_DEV_SMS_CODE", ""),
		AIProvider:    env("STEWARD_AI_PROVIDER", "fake"),
		OpenAIAPIKey:  env("STEWARD_OPENAI_API_KEY", ""),
		OpenAIBaseURL: env("STEWARD_OPENAI_BASE_URL", ""),
		StorageDriver: env("STEWARD_STORAGE_DRIVER", "filesystem"),
		StorageRoot:   env("STEWARD_STORAGE_ROOT", "./.local/storage"),
	}

	var err error
	if cfg.AccessTokenTTL, err = duration("STEWARD_ACCESS_TOKEN_TTL", 2*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.RefreshTokenTTL, err = duration("STEWARD_REFRESH_TOKEN_TTL", 30*24*time.Hour); err != nil {
		return Config{}, err
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("必须设置 STEWARD_DATABASE_URL")
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("必须设置 STEWARD_JWT_SECRET")
	}
	if cfg.AIProvider == "openai" && cfg.OpenAIAPIKey == "" {
		return Config{}, errors.New("STEWARD_AI_PROVIDER=openai 时必须设置 STEWARD_OPENAI_API_KEY")
	}

	return cfg, nil
}

// LoadForTest 返回指向测试库的配置，缺少测试库地址时返回空字符串由调用方跳过。
func LoadForTest() Config {
	_ = godotenv.Load(findEnvFile()...)
	return Config{
		DatabaseURL:     os.Getenv("STEWARD_TEST_DATABASE_URL"),
		JWTSecret:       "test-secret",
		AccessTokenTTL:  time.Hour,
		RefreshTokenTTL: time.Hour,
		AIProvider:      "fake",
		DevSMSCode:      "123456",
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
