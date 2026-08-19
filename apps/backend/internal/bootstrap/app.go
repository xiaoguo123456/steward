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
	authmod "github.com/guoxiaozheng1/steward/apps/backend/internal/modules/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/captures"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/users"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/fake"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/openai"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/jobs"
)

// Server 组合全部模块的 API 层，实现生成的 StrictServerInterface。
//
// 每个模块的类型名各不相同，因此可以直接嵌入并依靠 Go 的方法提升；
// 下面的编译期断言保证契约里的每一个操作都有实现，漏掉一个就编译不过。
type Server struct {
	*authmod.SessionAPI
	*users.ProfileAPI
	*lists.ListAPI
	*objects.ObjectAPI
	*trackers.TrackerAPI
	*views.ViewAPI
	*captures.CaptureAPI
	*activity.ActivityAPI
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

	parser, err := newParser(cfg, logger)
	if err != nil {
		db.Close()
		return nil, err
	}

	// 构造顺序遵循依赖方向：被依赖的模块先于依赖它们的模块。
	activitySvc := activity.New(db)
	listsSvc := lists.New(db)
	usersSvc := users.New(db, listsSvc)
	objectsSvc := objects.New(db, listsSvc, usersSvc, activitySvc)
	trackersSvc := trackers.New(db, usersSvc, activitySvc)
	viewsSvc := views.New(db, usersSvc)

	// Capture 需要队列才能入队，而队列的 Worker 又需要 Capture 服务。
	// 用一个延迟绑定的入队器打破这个循环，绑定发生在任何请求到达之前。
	enqueuer := &lazyEnqueuer{}
	capturesSvc := captures.New(db, parser, objectsSvc, trackersSvc,
		listsSvc, usersSvc, activitySvc, enqueuer)

	runtime, err := jobs.New(db.Pool, capturesSvc, logger, opts.RunWorkers)
	if err != nil {
		db.Close()
		return nil, err
	}
	enqueuer.inner = runtime.Enqueuer

	authSvc := authmod.New(db, tokens, usersSvc, cfg.DevSMSCode)

	return &App{
		Config: cfg,
		Logger: logger,
		DB:     db,
		Tokens: tokens,
		Server: &Server{
			SessionAPI: authmod.NewSessionAPI(authSvc),
			ProfileAPI: users.NewProfileAPI(usersSvc),
			ListAPI:    lists.NewListAPI(listsSvc),
			ObjectAPI:  objects.NewObjectAPI(objectsSvc),
			TrackerAPI: trackers.NewTrackerAPI(trackersSvc),
			ViewAPI:    views.NewViewAPI(viewsSvc),
			CaptureAPI: captures.NewCaptureAPI(capturesSvc),
			// 撤销必须回到拥有资源的模块执行，Activity 自己不改别人的表。
			ActivityAPI: activity.NewActivityAPI(activitySvc, objectsSvc, trackersSvc),
		},
		Jobs:   runtime,
		Parser: parser,
	}, nil
}

// lazyEnqueuer 把入队请求转发给稍后注入的实现。
//
// 它只在组装阶段处于未绑定状态；如果真的在未绑定时被调用，
// 说明组装顺序出了问题，此时必须明确报错而不是静默丢弃任务。
type lazyEnqueuer struct {
	inner captures.JobEnqueuer
}

func (l *lazyEnqueuer) EnqueueCaptureParse(ctx context.Context, q *dbgen.Queries, args captures.CaptureParseArgs) error {
	if l.inner == nil {
		return fmt.Errorf("任务队列尚未初始化，无法登记解析任务")
	}
	return l.inner.EnqueueCaptureParse(ctx, q, args)
}

// newParser 按配置选择 Capture 解析实现。
//
// 未配置任何 Provider 时使用确定性的本地实现：
// 即使所有 Provider 关闭，用户仍可用表单管理全部正式内容。
func newParser(cfg config.Config, logger *slog.Logger) (ai.CaptureParser, error) {
	switch cfg.AIProvider {
	case "", "fake":
		logger.Info("Capture 使用确定性本地解析，不会发起任何外部请求")
		return fake.New(), nil
	case "openai":
		logger.Warn("OpenAI Adapter 尚未接入真实模型，暂时回退到本地解析")
		return openai.New(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, fake.New()), nil
	default:
		return nil, fmt.Errorf("不支持的 STEWARD_AI_PROVIDER=%s", cfg.AIProvider)
	}
}

// Close 释放资源。
func (a *App) Close() {
	if a.DB != nil {
		a.DB.Close()
	}
}
