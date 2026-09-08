package config

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// AdminConfig 是后台管理进程的配置。
//
// **和公共 API 的配置分开加载**：后台跑在独立进程上，
// 它不该因为缺少某个业务配置而起不来，公共 API 也不该因为
// 没配管理员口令而拒绝启动。
type AdminConfig struct {
	HTTPAddr string
	// AllowedOrigins 是允许发起写请求的来源。
	//
	// 这不是 CORS 的便利设置，是 CSRF 防线的一半：
	// 浏览器不允许脚本伪造 Origin，所以它比任何自定义头都可靠。
	AllowedOrigins []string

	// DatabaseURL 必须指向 steward_admin 角色，不能复用 steward_app。
	// 两者的权限范围不同，混用等于把后台能做的事扩大到整个业务面。
	DatabaseURL string

	SMS        SMSConfig
	DevSMSCode string
	// CredentialVersion 变化后所有旧会话立刻失效。
	// 改口令时递增它，不用逐条去删会话，也不会漏掉正在用的那些。
	CredentialVersion string
	SessionSecret     string
	CSRFSecret        string

	// IdleTimeout 是空闲超时，每次请求往后推。
	IdleTimeout time.Duration
	// AbsoluteTimeout 不随请求延长。只有空闲超时的话，
	// 一个一直开着的标签页可以让会话永远活着。
	AbsoluteTimeout time.Duration

	// ReportingTimezone 决定后台所有日报按哪个时区切日。
	ReportingTimezone string
	// Environment 非 production 时界面上常驻显示，避免在生产上误操作。
	Environment string

	// CookieSecure 只在本地明文调试时才允许关掉。
	CookieSecure bool

	// PhoneLookupKey 是手机号查询散列的密钥。
	//
	// **必须和聚合任务用的是同一把**——聚合在 Worker 进程里算散列入库，
	// 后台在这里算散列去比对，两边不一致的话精确查询永远查不到，
	// 而且不会报错，只会安静地返回空列表。
	//
	// 复用 STEWARD_MEMORY_FINGERPRINT_KEY：它已经是「服务端内部、
	// 轮换会让历史散列失效」的同一类密钥，两个进程都读得到。
	PhoneLookupKey string
}

// LoadAdmin 读取后台配置。
func LoadAdmin() (AdminConfig, error) {
	// .env 只在本地存在；缺失不是错误。
	_ = godotenv.Load(findEnvFile()...)

	cfg := AdminConfig{
		HTTPAddr:          env("STEWARD_ADMIN_HTTP_ADDR", ":8788"),
		AllowedOrigins:    splitAndTrim(env("STEWARD_ADMIN_ALLOWED_ORIGINS", "http://localhost:8000")),
		DatabaseURL:       env("STEWARD_ADMIN_DATABASE_URL", ""),
		SMS:               SMSConfig{Provider: env("STEWARD_SMS_PROVIDER", "dev"), Endpoint: env("STEWARD_ALIYUN_SMS_ENDPOINT", "dysmsapi.aliyuncs.com"), AccessKeyID: env("STEWARD_ALIYUN_SMS_ACCESS_KEY_ID", ""), AccessKeySecret: env("STEWARD_ALIYUN_SMS_ACCESS_KEY_SECRET", ""), SignName: env("STEWARD_ALIYUN_SMS_SIGN_NAME", ""), TemplateCode: env("STEWARD_ALIYUN_SMS_TEMPLATE_CODE", "")},
		DevSMSCode:        env("STEWARD_DEV_SMS_CODE", ""),
		CredentialVersion: env("STEWARD_ADMIN_CREDENTIAL_VERSION", "1"),
		SessionSecret:     env("STEWARD_ADMIN_SESSION_SECRET", ""),
		CSRFSecret:        env("STEWARD_ADMIN_CSRF_SECRET", ""),
		IdleTimeout:       adminDuration("STEWARD_ADMIN_IDLE_TIMEOUT", 30*time.Minute),
		AbsoluteTimeout:   adminDuration("STEWARD_ADMIN_ABSOLUTE_TIMEOUT", 12*time.Hour),
		ReportingTimezone: env("STEWARD_ADMIN_REPORTING_TIMEZONE", "Asia/Shanghai"),
		Environment:       env("STEWARD_ENVIRONMENT", "development"),
		CookieSecure:      env("STEWARD_ADMIN_COOKIE_SECURE", "true") != "false",
		PhoneLookupKey:    env("STEWARD_MEMORY_FINGERPRINT_KEY", ""),
	}

	// 缺任何一项都直接拒绝启动。
	//
	// **不给默认口令、不给默认密钥。** 一个「本地方便」的默认管理员口令
	// 迟早会跟着镜像上生产——这类事故的成本远高于第一次配置的麻烦。
	missing := []string{}
	for key, value := range map[string]string{
		"STEWARD_ADMIN_DATABASE_URL":   cfg.DatabaseURL,
		"STEWARD_ADMIN_SESSION_SECRET": cfg.SessionSecret,
		"STEWARD_ADMIN_CSRF_SECRET":    cfg.CSRFSecret,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return AdminConfig{}, errors.New("后台配置缺少：" + strings.Join(missing, "、"))
	}
	if err := cfg.SMS.validate(cfg.DevSMSCode, cfg.Environment); err != nil {
		return AdminConfig{}, err
	}
	if len(cfg.SessionSecret) < 32 || len(cfg.CSRFSecret) < 32 {
		return AdminConfig{}, errors.New("后台密钥至少 32 字符")
	}
	if cfg.SessionSecret == cfg.CSRFSecret {
		// 两个密钥用途不同、轮换周期也不同，复用会让一次泄漏同时打穿两道防线。
		return AdminConfig{}, errors.New("会话密钥与 CSRF 密钥不能相同")
	}
	return cfg, nil
}

// adminDuration 读一个时长配置，取值不合法时退回默认值。
func adminDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

// AdminTestDatabaseURL 返回后台集成测试用的连接串。
//
// 后台的表在 admin schema 里，只有 steward_admin 进得去；
// steward_app 连 USAGE 权限都没有——**这正是设计要的**，
// 所以测试不能复用 STEWARD_TEST_DATABASE_URL。
//
// 没有显式配置时，从测试库地址推出同库的 steward_admin 连接：
// 迁移已经在测试库上建好了这个角色。
func AdminTestDatabaseURL() string {
	// 和 LoadForTest 一样先加载 .env：go test 的工作目录是被测包所在目录，
	// 不主动加载的话这里永远读不到配置，测试会**静默全部跳过**——
	// 而跳过的测试在输出里和通过长得一模一样。
	_ = godotenv.Load(findEnvFile()...)

	if explicit := strings.TrimSpace(os.Getenv("STEWARD_TEST_ADMIN_DATABASE_URL")); explicit != "" {
		return explicit
	}
	base := strings.TrimSpace(os.Getenv("STEWARD_TEST_DATABASE_URL"))
	if base == "" {
		return ""
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return ""
	}
	parsed.User = url.UserPassword("steward_admin", "steward_admin_dev_password")
	return parsed.String()
}
