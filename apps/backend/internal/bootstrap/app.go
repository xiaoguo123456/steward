// Package bootstrap 组装配置、平台组件与业务模块。
//
// 这里是唯一知道全部模块的地方：模块之间只通过各自声明的窄接口通信，
// 具体实现在这里注入，因此不会出现跨模块的直接依赖。
package bootstrap

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/aggregate"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	authmod "github.com/guoxiaozheng1/steward/apps/backend/internal/modules/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/captures"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/media"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/memory"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/memorymoments"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/moodjournal"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/recipes"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/retention"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/users"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/fake"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/openai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/direct"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/jobs"
	aliyunsms "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/sms/aliyun"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage/aliyunoss"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage/localfs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams/pgnotify"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams/redisstream"
)

// Server 组合全部模块的 API 层，实现生成的 StrictServerInterface。
//
// 每个模块的类型名各不相同，因此可以直接嵌入并依靠 Go 的方法提升；
// 下面的编译期断言保证契约里的每一个操作都有实现，漏掉一个就编译不过。
type Server struct {
	*authmod.SessionAPI
	*users.ProfileAPI
	*retention.AccountDeletionAPI
	*lists.ListAPI
	*objects.ObjectAPI
	*trackers.TrackerAPI
	*views.ViewAPI
	*captures.CaptureAPI
	*media.MediaAPI
	*activity.ActivityAPI
	*assistant.AssistantAPI
	*memory.MemoryAPI
	*memorymoments.MemoryMomentAPI
	*recipes.RecipeAPI
	*moodjournal.API
}

var _ httpapi.StrictServerInterface = (*Server)(nil)

// App 是组装完成的应用。
type App struct {
	Config config.Config
	Logger *slog.Logger
	DB     *database.DB
	Tokens *authpkg.TokenService
	Server *Server
	Jobs   *jobs.Runtime
	Parser ai.CaptureParser
	Store  storage.ObjectStore
	// Capabilities 保存全部已登记能力，供健康检查与调试查看。
	Capabilities []string
	// Assistant、Stream 与 StreamLimiter 供手工挂载的 SSE 端点使用。
	// Stream 为空表示进度流关闭，客户端只能轮询。
	Assistant     *assistant.Service
	Stream        streams.Transport
	StreamLimiter *streams.Limiter
	// AccountActive 为无状态 Access Token 补充实时账号状态检查。
	AccountActive func(context.Context, string) (bool, error)
	// LocalStore 只在使用本地存储时非空，供路由挂载传输端点。
	LocalStore *localfs.Store
}

// Options 控制组装行为。
type Options struct {
	// RunWorkers 为 true 时本进程同时执行队列任务。
	// Worker 进程置为 true；API 进程默认只入队。
	RunWorkers bool
}

// New 组装应用。
func New(ctx context.Context, cfg config.Config, logger *slog.Logger, opts Options) (*App, error) {
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}

	tokens := authpkg.NewTokenService(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	codeSender, err := newCodeSender(cfg, logger)
	if err != nil {
		db.Close()
		return nil, err
	}

	parser, err := newParser(cfg, logger)
	if err != nil {
		db.Close()
		return nil, err
	}

	store, localStore, err := newObjectStore(cfg, logger)
	if err != nil {
		db.Close()
		return nil, err
	}

	// 构造顺序遵循依赖方向：被依赖的模块先于依赖它们的模块。
	// Capture、归档、时光媒体清理与账号删除都需要队列；用延迟绑定打破
	// Service 与 Worker Runtime 的组装环，绑定发生在任何请求到达之前。
	enqueuer := &lazyEnqueuer{}
	retentionEnqueuer := &lazyRetentionEnqueuer{}
	activitySvc := activity.New(db)
	listsSvc := lists.New(db).WithArchiveRetention(cfg.TaskListArchiveRetention)
	usersSvc := users.New(db, listsSvc)
	mediaSvc := media.New(db, store)
	memoryMomentsSvc := memorymoments.New(db, mediaSvc, activitySvc, enqueuer)
	objectsSvc := objects.New(db, listsSvc, usersSvc, activitySvc, mediaSvc)
	moodJournalSvc := moodjournal.New(db, objectsSvc, usersSvc, activitySvc)
	trackersSvc := trackers.New(db, usersSvc, activitySvc)
	viewsSvc := views.New(db, usersSvc)
	recipesSvc := recipes.New(db, usersSvc, listsSvc, objectsSvc)

	trackersSvc.WithJobs(enqueuer)
	listsSvc.WithJobs(enqueuer)
	// Provider 同时实现解析与媒体处理时把它接上；fake 只做解析，媒体处理为空，
	// 此时图片与语音会被标记为失败并提示用户改用文字，而不是伪造识别结果。
	processor, _ := parser.(ai.MediaProcessor)
	// 每一次模型调用都要留一条审计：走了哪个 Provider 与模型、
	// 用了多少 token、花了多久、成没成功。**只记形状不记正文。**
	auditor := aiaudit.New(db, logger)

	// 后台读模型的聚合。它以 steward_app 身份跑，逐个用户开 RLS 事务——
	// 后台看得到统计，但没有任何一条路径能一次读到所有人的原始数据。
	costsSvc := costs.New(db, logger)
	aggregateSvc := aggregate.New(db, costsSvc,
		[]byte(cfg.MemoryFingerprintKey), cfg.AdminReportingTimezone, logger)

	capturesSvc := captures.New(db, parser, processor, mediaSvc,
		objectsSvc, trackersSvc, listsSvc, usersSvc, activitySvc, enqueuer, auditor)

	// Assistant 与 Memory 互相需要对方的窄接口：
	// Assistant 检索记忆，Memory 的写入由 Assistant 的建议确认触发。
	// 两个方向都是接口，实体在这里注入。
	memorySvc := memory.New(db, []byte(cfg.MemoryFingerprintKey))
	proposalSvc := assistant.NewProposalService(db, objectsSvc, listsSvc,
		usersSvc, activitySvc, memorySvc)

	registry := ai.NewRegistry()
	capabilityDeps := assistant.CapabilityDeps{
		Tasks:   objectsSvc,
		Views:   viewsSvc,
		Records: trackersSvc,
		Memory:  memorySvc,
	}
	assistant.RegisterReadOnly(registry, capabilityDeps)
	assistant.RegisterProposals(registry, capabilityDeps)

	chat := newChatProvider(parser)
	objectsSvc.WithNotePolisher(chat, auditor)
	engine := newEngine(chat, logger)
	stream, streamLimit, err := newStreamTransport(ctx, cfg, db, logger)
	if err != nil {
		db.Close()
		return nil, err
	}

	assistantSvc := assistant.New(db, engine, registry,
		usersSvc, enqueuer, proposalSvc, memorySvc, auditor, logger)
	if stream != nil {
		assistantSvc = assistantSvc.WithStream(stream)
	}
	viewsSvc.WithNarrative(chat, enqueuer, auditor, logger)
	retentionSvc := retention.New(db, store, tokens, retentionEnqueuer,
		cfg.AccountDeletionBackupRetention)

	runtime, err := jobs.New(db.Pool, jobs.Deps{
		Captures:  capturesSvc,
		Assistant: assistantSvc,
		Views:     viewsSvc,
		Trackers:  trackersSvc,
		Lists:     listsSvc,
		Media:     mediaSvc,
		Retention: retentionSvc,
		Aggregate: aggregateSvc,
	}, logger, opts.RunWorkers)
	if err != nil {
		db.Close()
		return nil, err
	}
	enqueuer.inner = runtime.Enqueuer
	retentionEnqueuer.inner = runtime.Enqueuer

	authSvc := authmod.New(db, tokens, usersSvc, cfg.DevSMSCode, codeSender)

	return &App{
		Config: cfg,
		Logger: logger,
		DB:     db,
		Tokens: tokens,
		Server: &Server{
			SessionAPI:         authmod.NewSessionAPI(authSvc),
			ProfileAPI:         users.NewProfileAPI(usersSvc),
			AccountDeletionAPI: retention.NewAccountDeletionAPI(retentionSvc),
			ListAPI:            lists.NewListAPI(listsSvc),
			ObjectAPI:          objects.NewObjectAPI(objectsSvc),
			TrackerAPI:         trackers.NewTrackerAPI(trackersSvc),
			ViewAPI:            views.NewViewAPI(viewsSvc),
			CaptureAPI:         captures.NewCaptureAPI(capturesSvc),
			MediaAPI:           media.NewMediaAPI(mediaSvc),
			// 撤销必须回到拥有资源的模块执行，Activity 自己不改别人的表。
			ActivityAPI:     activity.NewActivityAPI(activitySvc, objectsSvc, trackersSvc),
			AssistantAPI:    assistant.NewAssistantAPI(assistantSvc, proposalSvc),
			MemoryAPI:       memory.NewMemoryAPI(memorySvc),
			MemoryMomentAPI: memorymoments.NewAPI(memoryMomentsSvc),
			RecipeAPI:       recipes.NewRecipeAPI(recipesSvc),
			API:             moodjournal.NewAPI(moodJournalSvc),
		},
		Jobs:          runtime,
		Parser:        parser,
		Store:         store,
		LocalStore:    localStore,
		Capabilities:  registry.Names(),
		Assistant:     assistantSvc,
		Stream:        stream,
		StreamLimiter: streams.NewLimiter(streamLimit),
		AccountActive: authSvc.AccountActive,
	}, nil
}

func newCodeSender(cfg config.Config, logger *slog.Logger) (authmod.CodeSender, error) {
	switch cfg.SMS.Provider {
	case "dev":
		logger.Info("验证码使用固定测试值，不调用短信 Provider", "environment", cfg.Environment)
		return nil, nil
	case "aliyun":
		sender, err := aliyunsms.New(aliyunsms.Config{
			Endpoint:        cfg.SMS.Endpoint,
			AccessKeyID:     cfg.SMS.AccessKeyID,
			AccessKeySecret: cfg.SMS.AccessKeySecret,
			SignName:        cfg.SMS.SignName,
			TemplateCode:    cfg.SMS.TemplateCode,
		}, logger)
		if err != nil {
			return nil, err
		}
		logger.Info("验证码使用阿里云短信", "endpoint", cfg.SMS.Endpoint)
		return sender, nil
	default:
		return nil, fmt.Errorf("不支持的 STEWARD_SMS_PROVIDER=%s", cfg.SMS.Provider)
	}
}

// newObjectStore 按配置选择对象存储适配器。
//
// 默认使用本地文件系统：没有任何云凭证时上传链路依然可以完整跑通，
// 客户端代码与生产环境完全一致。
func newObjectStore(cfg config.Config, logger *slog.Logger) (storage.ObjectStore, *localfs.Store, error) {
	switch cfg.Storage.Driver {
	case "", "localfs":
		store, err := localfs.New(localfs.Config{
			Root:    cfg.Storage.Root,
			BaseURL: cfg.PublicBaseURL,
			// 与 JWT 共用密钥来源，但签名内容包含方法与对象键，用途不会混淆。
			Secret: cfg.JWTSecret,
		})
		if err != nil {
			return nil, nil, err
		}
		logger.Info("媒体使用本地文件系统存储，仅适用于开发", "root", cfg.Storage.Root)
		return store, store, nil
	case "aliyun-oss":
		store, err := aliyunoss.New(aliyunoss.Config{
			Endpoint:        cfg.Storage.OSSEndpoint,
			Region:          cfg.Storage.OSSRegion,
			Bucket:          cfg.Storage.OSSBucket,
			Prefix:          cfg.Storage.OSSPrefix,
			AccessKeyID:     cfg.Storage.OSSAccessKeyID,
			AccessKeySecret: cfg.Storage.OSSAccessKeySecret,
		})
		if err != nil {
			return nil, nil, err
		}
		logger.Info("媒体使用阿里云 OSS",
			"bucket", cfg.Storage.OSSBucket, "region", cfg.Storage.OSSRegion,
			"prefix", cfg.Storage.OSSPrefix)
		return store, nil, nil
	default:
		return nil, nil, fmt.Errorf("不支持的 STEWARD_STORAGE_DRIVER=%s", cfg.Storage.Driver)
	}
}

// newStreamTransport 按配置选择进度流的传输，并给出并发上限。
//
// 返回 nil 表示关闭进度流：客户端退回轮询，功能不受影响。
// 这条通道从来不承载权威状态，因此「换传输」和「整个关掉」都是安全的。
func newStreamTransport(ctx context.Context, cfg config.Config, db *database.DB,
	logger *slog.Logger) (streams.Transport, int, error) {

	limit := cfg.Stream.MaxConcurrent

	switch cfg.Stream.Resolve() {
	case "off":
		logger.Info("Turn 进度流已关闭，客户端使用轮询")
		return nil, 0, nil

	case "redis":
		transport, err := redisstream.New(ctx, cfg.Stream.RedisURL, cfg.Stream.Namespace, logger)
		if err != nil {
			return nil, 0, err
		}
		if limit <= 0 {
			// 订阅连接便宜，可以放得比数据库方案高一到两个数量级。
			limit = 256
		}
		logger.Info("Turn 进度流使用 Redis Pub/Sub",
			"namespace", cfg.Stream.Namespace, "max_concurrent", limit)
		return transport, limit, nil

	default:
		if limit <= 0 {
			// 每条流独占一个数据库连接（LISTEN 是连接级状态），
			// 上限必须明显小于连接池，否则长连接会把池占满，
			// 普通请求排不上队。
			limit = 6
		}
		logger.Info("Turn 进度流使用 PostgreSQL LISTEN/NOTIFY",
			"max_concurrent", limit,
			"note", "部署里有 Redis 时设置 STEWARD_REDIS_URL 可以去掉连接占用")
		return pgnotify.New(db.Pool, logger), limit, nil
	}
}

// lazyEnqueuer 把入队请求转发给稍后注入的实现。
//
// 它只在组装阶段处于未绑定状态；如果真的在未绑定时被调用，
// 说明组装顺序出了问题，此时必须明确报错而不是静默丢弃任务。
type lazyEnqueuer struct {
	inner *jobs.Enqueuer
}

// lazyRetentionEnqueuer 解决 Retention Service 与 Worker Runtime 的组装环。
type lazyRetentionEnqueuer struct {
	inner *jobs.Enqueuer
}

func (l *lazyRetentionEnqueuer) EnqueueAccountDeletion(
	ctx context.Context, q *dbgen.Queries, args retention.AccountDeletionArgs,
) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记账号删除任务")
	}
	return l.inner.EnqueueAccountDeletion(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueCaptureParse(ctx context.Context, q *dbgen.Queries, args captures.CaptureParseArgs) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记解析任务")
	}
	return l.inner.EnqueueCaptureParse(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueAssistantRespond(ctx context.Context, q *dbgen.Queries, args assistant.RespondArgs) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记回复任务")
	}
	return l.inner.EnqueueAssistantRespond(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueReviewGenerate(ctx context.Context, q *dbgen.Queries, args views.GenerateArgs) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记复盘生成任务")
	}
	return l.inner.EnqueueReviewGenerate(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueTrackerArchiveCleanup(
	ctx context.Context, q *dbgen.Queries, args trackers.ArchiveCleanupArgs,
) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记打卡项归档清理任务")
	}
	return l.inner.EnqueueTrackerArchiveCleanup(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueTaskListArchiveCleanup(
	ctx context.Context, q *dbgen.Queries, args lists.ArchiveCleanupArgs,
) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记清单归档清理任务")
	}
	return l.inner.EnqueueTaskListArchiveCleanup(ctx, q, args)
}

func (l *lazyEnqueuer) EnqueueMemoryMomentMediaDeletion(
	ctx context.Context, q *dbgen.Queries, args memorymoments.MediaDeletionArgs,
) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记时光媒体清理任务")
	}
	return l.inner.EnqueueMemoryMomentMediaDeletion(ctx, q, args)
}

// newChatProvider 从解析器里取出对话能力。
//
// fake 解析器不实现 ChatProvider，此时返回 nil：Assistant 会明确告诉用户
// 对话功能不可用，而不是用一个假回复冒充模型。
func newChatProvider(parser ai.CaptureParser) ai.ChatProvider {
	chat, _ := parser.(ai.ChatProvider)
	return chat
}

// newEngine 构造编排引擎。
func newEngine(chat ai.ChatProvider, logger *slog.Logger) ai.OrchestrationEngine {
	if chat == nil {
		return unavailableEngine{}
	}
	return direct.New(chat, logger)
}

// unavailableEngine 在没有配置模型服务时接管对话。
//
// 它明确报"不可用"而不是返回一段编好的话：用户需要知道这次没有真的问到模型。
type unavailableEngine struct{}

func (unavailableEngine) RunTurn(context.Context, ai.TurnRequest) (ai.TurnResult, error) {
	return ai.TurnResult{}, ai.ErrProviderUnavailable
}

func (unavailableEngine) Version() string { return "unavailable" }

// newParser 按配置选择 Capture 解析实现。
//
// 未配置任何 Provider 时使用确定性的本地实现：
// 即使所有 Provider 关闭，用户仍可用表单管理全部正式内容。
func newParser(cfg config.Config, logger *slog.Logger) (ai.CaptureParser, error) {
	switch cfg.AI.Provider {
	case "", "fake":
		logger.Info("Capture 使用确定性本地解析，不会发起任何外部请求")
		return fake.New(), nil
	case "openai":
		logger.Info("Capture 使用兼容 OpenAI 协议的模型服务",
			"base_url", cfg.AI.BaseURL, "model", cfg.AI.ModelParse)
		return openai.New(openai.Config{
			BaseURL:         cfg.AI.BaseURL,
			APIKey:          cfg.AI.APIKey,
			ParseModel:      cfg.AI.ModelParse,
			VisionModel:     cfg.AI.ModelVision,
			ChatModel:       cfg.AI.ModelChat,
			TranscribeModel: cfg.AI.ModelTranscribe,
			Timeout:         cfg.AI.Timeout,
			MaxOutputTokens: cfg.AI.MaxOutputTokens,
			Fallback:        fake.New(),
			Logger:          logger,
		})
	default:
		return nil, fmt.Errorf("不支持的 STEWARD_AI_PROVIDER=%s", cfg.AI.Provider)
	}
}

// Close 释放资源。
func (a *App) Close() {
	if a.Stream != nil {
		_ = a.Stream.Close()
	}
	if a.DB != nil {
		a.DB.Close()
	}
}
