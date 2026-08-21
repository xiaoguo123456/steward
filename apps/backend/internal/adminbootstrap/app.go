// Package adminbootstrap 组装后台管理进程。
//
// 它是唯一知道后台全部模块的地方，和公共 API 的 bootstrap 完全平行。
// **两者不共用路由、不共用中间件链、不共用数据库连接**——
// 分开的目的就是让「普通用户能不能碰到后台」有一个结构性的答案。
package adminbootstrap

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/readapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/writeapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// App 是后台进程的全部依赖。
type App struct {
	Config config.AdminConfig
	Logger *slog.Logger
	DB     *database.DB

	Server *Server

	middleware *auth.Middleware
}

// Server 实现 adminapi.StrictServerInterface。
//
// 各模块的 API 类型名各不相同，因此可以直接嵌入并靠 Go 的方法提升；
// 下面那行编译期断言保证漏实现任何一个操作都编译不过。
type Server struct {
	*auth.SessionAPI
	*readapi.ReadAPI
	*writeapi.WriteAPI
}

var _ adminapi.StrictServerInterface = (*Server)(nil)

// New 组装后台。
func New(ctx context.Context, cfg config.AdminConfig, logger *slog.Logger) (*App, func(), error) {
	if logger == nil {
		logger = slog.Default()
	}

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, nil, err
	}

	// 手机号查询散列的密钥。**和会话密钥分开**：它的轮换会让所有已存散列
	// 失效，不该被别的用途牵着走。这里暂时复用 CSRF 密钥的值——
	// 聚合任务用的是主配置里的 MemoryFingerprintKey，两边必须一致，
	// 否则查询算出来的散列和入库时的对不上，精确查询永远查不到。
	phoneKey := []byte(cfg.PhoneLookupKey)

	sessions := auth.NewService(db, cfg)
	middleware := auth.NewMiddleware(sessions, cfg, logger)
	limiter := auth.NewLoginLimiter()

	app := &App{
		Config: cfg,
		Logger: logger,
		DB:     db,
		Server: &Server{
			SessionAPI: auth.NewSessionAPI(sessions, middleware, limiter, cfg, logger),
			// 手机号查询用的 HMAC 密钥必须和聚合时用的是同一把，
			// 否则算出来的散列对不上，精确查询永远查不到。
			ReadAPI: readapi.NewReadAPI(db, cfg, phoneKey, logger),
			WriteAPI: writeapi.NewWriteAPI(
				writeapi.New(db, logger), costs.New(db, logger), logger),
		},
	}
	app.middleware = middleware
	return app, db.Close, nil
}

// Handler 组装路由。
func (a *App) Handler() http.Handler {
	r := chi.NewRouter()

	// 顺序有讲究：
	//   RequestID  → 出错时能报一个可查的号
	//   Recoverer  → panic 不能把整个后台带下去
	//   Request    → 登录要读 Origin 与来源 IP
	//   PrivateCache → 后台响应一律不进任何缓存
	//   Authenticate → 除登录外都要会话
	//   ProtectWrites → 写请求另外校验 Origin 与 CSRF
	r.Use(httpx.RequestIDMiddleware)
	r.Use(httpx.RecovererMiddleware(a.Logger))
	r.Use(httpx.RequestMiddleware)
	r.Use(a.middleware.PrivateCache)
	r.Use(a.middleware.Authenticate)
	r.Use(a.middleware.ProtectWrites)

	// 运维探针不属于产品契约，因此不放进 Admin OpenAPI。
	r.Get("/healthz", a.healthHandler)

	handler := adminapi.NewStrictHandler(a.Server, nil)
	adminapi.HandlerFromMux(handler, r)
	return r
}
