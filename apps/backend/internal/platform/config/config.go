// Package config 负责从环境变量加载运行配置。
// 所有默认值只适用于本地开发；生产环境必须显式提供。
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config 保存进程启动所需的全部配置。
type Config struct {
	HTTPAddr    string
	CORSOrigins []string
	// Environment 用于阻止生产环境误启用测试 Provider。
	Environment string
	// PublicBaseURL 是 API 对外可达的地址，本地存储用它生成签名 URL。
	PublicBaseURL string

	DatabaseURL string

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	DevSMSCode      string
	// TaskListArchiveRetention 是任务清单归档后的可恢复时长。
	// API 与 Worker 必须使用同一配置，避免界面提示与实际清理时间不一致。
	TaskListArchiveRetention time.Duration
	// AccountDeletionBackupRetention 是删除完成后备份系统的最长自然过期窗口。
	// 在线主库和对象存储仍由 Worker 立即清理；生产环境应按已确认的备份策略配置。
	AccountDeletionBackupRetention time.Duration

	// MemoryFingerprintKey 用于计算「不再学习」阻止项的指纹。
	// 它是独立用途的密钥，不复用 JWT 密钥：两者的轮换周期与泄漏影响完全不同。
	MemoryFingerprintKey string

	// AdminReportingTimezone 是后台报表时区。聚合任务跑在 Worker 进程里，
	// 因此这一项在主配置里也要有——两个进程必须按同一个时区切日，
	// 否则后台看到的「今天」和聚合算的「今天」会差一天。
	AdminReportingTimezone string

	AI      AIConfig
	SMS     SMSConfig
	Storage StorageConfig
	Stream  StreamConfig
}

var fixedSMSCodePattern = regexp.MustCompile(`^[0-9]{6}$`)

// SMSConfig 是验证码短信 Provider 配置。
type SMSConfig struct {
	// Provider 取 dev 或 aliyun。dev 只允许在本地和测试环境使用。
	Provider        string
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	SignName        string
	TemplateCode    string
}

// StreamConfig 是 Turn 进度流的配置。
//
// 这条通道不承载权威状态：整个关掉，客户端退回轮询，功能照常。
type StreamConfig struct {
	// Driver 取 auto、postgres、redis 或 off。
	//
	// auto 表示配了 Redis 就用 Redis，否则退回 PostgreSQL 的 LISTEN/NOTIFY。
	Driver string
	// RedisURL 形如 redis://user:pass@host:6379/0。
	RedisURL string
	// Namespace 隔离共享 Redis 上不同环境的 Pub/Sub 通道。
	// Redis 逻辑 DB 不隔离 Pub/Sub，因此测试和生产必须使用不同值。
	Namespace string
	// MaxConcurrent 是同时允许的流连接数。
	//
	// 留空时按驱动取默认值：postgres 每条流独占一个数据库连接，
	// 上限必须明显小于连接池；redis 的订阅连接便宜得多。
	MaxConcurrent int
}

// AIConfig 是模型 Provider 配置。
//
// 业务代码只引用逻辑用途（解析、视觉、转写），具体模型名在这里配置，
// 换模型不需要改动任何业务模块。
type AIConfig struct {
	// Provider 取 fake 或 openai。fake 只允许开发和测试环境使用。
	Provider string
	BaseURL  string
	APIKey   string

	ModelParse      string
	ModelVision     string
	ModelChat       string
	ModelTranscribe string
	// ApprovedSensitiveContent 只有在 Provider 的敏感数据等级、地区、保留、
	// 训练退出和删除能力都已经完成审核后才能打开。默认关闭，避免只凭用户同意
	// 就把心情日记正文发送给尚未批准的 Provider。
	ApprovedSensitiveContent bool

	Timeout         time.Duration
	MaxOutputTokens int
}

// StorageConfig 是对象存储配置。
type StorageConfig struct {
	// Driver 取 localfs 或 aliyun-oss。
	Driver string
	Root   string

	OSSRegion   string
	OSSEndpoint string
	OSSBucket   string
	// OSSPrefix 是 Bucket 内的物理对象前缀；数据库仍只保存逻辑对象键。
	OSSPrefix          string
	OSSAccessKeyID     string
	OSSAccessKeySecret string
}

// Load 读取 .env（如果存在）与进程环境变量，并校验必填项。
func Load() (Config, error) {
	// .env 只在本地存在；缺失不是错误。
	_ = godotenv.Load(findEnvFile()...)

	cfg := Config{
		HTTPAddr:               env("STEWARD_HTTP_ADDR", ":8787"),
		CORSOrigins:            splitAndTrim(env("STEWARD_CORS_ORIGINS", "http://localhost:8081,http://localhost:4174")),
		Environment:            strings.ToLower(strings.TrimSpace(env("STEWARD_ENVIRONMENT", "development"))),
		PublicBaseURL:          env("STEWARD_PUBLIC_BASE_URL", "http://localhost:8787"),
		DatabaseURL:            env("STEWARD_DATABASE_URL", ""),
		JWTSecret:              env("STEWARD_JWT_SECRET", ""),
		DevSMSCode:             env("STEWARD_DEV_SMS_CODE", ""),
		MemoryFingerprintKey:   env("STEWARD_MEMORY_FINGERPRINT_KEY", ""),
		AdminReportingTimezone: env("STEWARD_ADMIN_REPORTING_TIMEZONE", "Asia/Shanghai"),
		AI: AIConfig{
			Provider:        env("STEWARD_AI_PROVIDER", "fake"),
			BaseURL:         strings.TrimRight(env("STEWARD_AI_BASE_URL", ""), "/"),
			APIKey:          env("STEWARD_AI_API_KEY", ""),
			ModelParse:      env("STEWARD_AI_MODEL_PARSE", ""),
			ModelVision:     env("STEWARD_AI_MODEL_VISION", ""),
			ModelChat:       env("STEWARD_AI_MODEL_CHAT", ""),
			ModelTranscribe: env("STEWARD_AI_MODEL_TRANSCRIBE", ""),
			ApprovedSensitiveContent: strings.EqualFold(
				env("STEWARD_AI_APPROVED_SENSITIVE_CONTENT", "false"), "true",
			),
			MaxOutputTokens: envInt("STEWARD_AI_MAX_OUTPUT_TOKENS", 2048),
		},
		SMS: SMSConfig{
			Provider:        env("STEWARD_SMS_PROVIDER", "dev"),
			Endpoint:        env("STEWARD_ALIYUN_SMS_ENDPOINT", "dysmsapi.aliyuncs.com"),
			AccessKeyID:     env("STEWARD_ALIYUN_SMS_ACCESS_KEY_ID", ""),
			AccessKeySecret: env("STEWARD_ALIYUN_SMS_ACCESS_KEY_SECRET", ""),
			SignName:        env("STEWARD_ALIYUN_SMS_SIGN_NAME", ""),
			TemplateCode:    env("STEWARD_ALIYUN_SMS_TEMPLATE_CODE", ""),
		},
		Stream: StreamConfig{
			Driver:        env("STEWARD_STREAM_DRIVER", "auto"),
			RedisURL:      env("STEWARD_REDIS_URL", ""),
			Namespace:     env("STEWARD_STREAM_NAMESPACE", "steward"),
			MaxConcurrent: envInt("STEWARD_STREAM_MAX_CONCURRENT", 0),
		},
		Storage: StorageConfig{
			Driver:             env("STEWARD_STORAGE_DRIVER", "localfs"),
			Root:               env("STEWARD_STORAGE_ROOT", "./.local/storage"),
			OSSRegion:          env("STEWARD_OSS_REGION", ""),
			OSSEndpoint:        env("STEWARD_OSS_ENDPOINT", ""),
			OSSBucket:          env("STEWARD_OSS_BUCKET", ""),
			OSSPrefix:          env("STEWARD_OSS_PREFIX", ""),
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
	if cfg.TaskListArchiveRetention, err = duration("STEWARD_TASK_LIST_ARCHIVE_RETENTION", 72*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.TaskListArchiveRetention <= 0 {
		return Config{}, errors.New("STEWARD_TASK_LIST_ARCHIVE_RETENTION 必须大于 0")
	}
	if cfg.AccountDeletionBackupRetention, err = duration("STEWARD_ACCOUNT_DELETION_BACKUP_RETENTION", 30*24*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.AccountDeletionBackupRetention <= 0 {
		return Config{}, errors.New("STEWARD_ACCOUNT_DELETION_BACKUP_RETENTION 必须大于 0")
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
	if cfg.MemoryFingerprintKey == "" {
		return Config{}, errors.New("必须设置 STEWARD_MEMORY_FINGERPRINT_KEY")
	}

	if err := cfg.AI.validate(cfg.Environment); err != nil {
		return Config{}, err
	}
	if err := cfg.SMS.validate(cfg.DevSMSCode, cfg.Environment); err != nil {
		return Config{}, err
	}
	if err := cfg.Storage.validate(); err != nil {
		return Config{}, err
	}
	if err := cfg.Stream.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c SMSConfig) validate(devCode, environment string) error {
	switch c.Provider {
	case "dev":
		if environment == "production" {
			return errors.New("生产环境禁止使用 STEWARD_SMS_PROVIDER=dev")
		}
		if !fixedSMSCodePattern.MatchString(devCode) {
			return errors.New("STEWARD_SMS_PROVIDER=dev 时必须设置 6 位 STEWARD_DEV_SMS_CODE")
		}
		return nil
	case "aliyun":
		if environment == "test" {
			return errors.New("测试环境必须使用 STEWARD_SMS_PROVIDER=dev，避免发送真实短信")
		}
		if devCode != "" {
			return errors.New("STEWARD_SMS_PROVIDER=aliyun 时必须清空 STEWARD_DEV_SMS_CODE")
		}
		missing := make([]string, 0, 5)
		if c.Endpoint == "" {
			missing = append(missing, "STEWARD_ALIYUN_SMS_ENDPOINT")
		}
		if c.AccessKeyID == "" {
			missing = append(missing, "STEWARD_ALIYUN_SMS_ACCESS_KEY_ID")
		}
		if c.AccessKeySecret == "" {
			missing = append(missing, "STEWARD_ALIYUN_SMS_ACCESS_KEY_SECRET")
		}
		if c.SignName == "" {
			missing = append(missing, "STEWARD_ALIYUN_SMS_SIGN_NAME")
		}
		if c.TemplateCode == "" {
			missing = append(missing, "STEWARD_ALIYUN_SMS_TEMPLATE_CODE")
		}
		if len(missing) > 0 {
			return fmt.Errorf("STEWARD_SMS_PROVIDER=aliyun 时必须设置：%s", strings.Join(missing, "、"))
		}
		return nil
	default:
		return fmt.Errorf("不支持的 STEWARD_SMS_PROVIDER=%s，可选 dev 或 aliyun", c.Provider)
	}
}

// validate 检查 Provider 配置的完整性。
//
// 宁可启动失败也不要带着半套配置跑起来：那样第一次真实调用才会暴露问题，
// 而那时用户已经在等一个永远不会成功的解析。
func (c AIConfig) validate(environment string) error {
	switch c.Provider {
	case "", "fake":
		if environment == "production" {
			return errors.New("生产环境禁止使用 STEWARD_AI_PROVIDER=fake，必须显式配置真实模型 Provider")
		}
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

// validate 检查流配置的完整性。
func (c StreamConfig) validate() error {
	switch c.Driver {
	case "", "auto", "postgres", "off":
		return nil
	case "redis":
		if c.RedisURL == "" {
			return errors.New("STEWARD_STREAM_DRIVER=redis 时必须设置 STEWARD_REDIS_URL")
		}
		if !validStreamNamespace(c.Namespace) {
			return errors.New("STEWARD_STREAM_NAMESPACE 只能包含字母、数字、下划线和连字符，长度为 1 到 48")
		}
		return nil
	default:
		return fmt.Errorf("不支持的 STEWARD_STREAM_DRIVER=%s", c.Driver)
	}
}

func validStreamNamespace(value string) bool {
	if len(value) == 0 || len(value) > 48 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// Resolve 按配置与可用依赖算出实际驱动。
func (c StreamConfig) Resolve() string {
	if c.Driver == "auto" || c.Driver == "" {
		if c.RedisURL != "" {
			return "redis"
		}
		return "postgres"
	}
	return c.Driver
}

// LoadForTest 返回指向测试库的配置，缺少测试库地址时返回空字符串由调用方跳过。
func LoadForTest() Config {
	_ = godotenv.Load(findEnvFile()...)
	return Config{
		Environment:                    "test",
		DatabaseURL:                    os.Getenv("STEWARD_TEST_DATABASE_URL"),
		JWTSecret:                      "test-secret",
		AccessTokenTTL:                 time.Hour,
		RefreshTokenTTL:                time.Hour,
		DevSMSCode:                     "123456",
		TaskListArchiveRetention:       72 * time.Hour,
		AccountDeletionBackupRetention: 30 * 24 * time.Hour,
		MemoryFingerprintKey:           "test-fingerprint-key",
		AI:                             AIConfig{Provider: "fake"},
		SMS:                            SMSConfig{Provider: "dev"},
		Storage:                        StorageConfig{Driver: "localfs", Root: os.TempDir() + "/steward-test-storage"},
	}
}

// findEnvFile 逐级向上查找仓库根目录的 .env。
//
// 不写死几个「../」：go test 的工作目录是被测包所在目录，深度各不相同，
// 写死几级就会在某些包里悄悄失效——测试不会报错，只会跳过。
func findEnvFile() []string {
	dir, err := os.Getwd()
	if err != nil {
		return nil
	}
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return []string{candidate}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return nil
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
