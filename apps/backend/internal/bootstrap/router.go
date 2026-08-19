package bootstrap

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// Router 构造 HTTP 路由。
//
// 路由表完全来自生成代码：这里只负责挂载中间件与运维探针，
// 不手写任何业务路径。
func (a *App) Router() http.Handler {
	r := chi.NewRouter()

	r.Use(httpx.RequestIDMiddleware)
	r.Use(httpx.RecovererMiddleware(a.Logger))
	r.Use(httpx.CORSMiddleware(a.Config.CORSOrigins))
	r.Use(httpx.PrivateCacheMiddleware)
	r.Use(httpx.AuthMiddleware(a.Tokens))

	// /healthz 是运维探针，不属于产品 API 契约，因此不在 OpenAPI 中定义。
	r.Get("/healthz", a.healthHandler)

	strict := httpapi.NewStrictHandlerWithOptions(a.Server, nil, httpapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  httpx.RequestErrorHandler,
		ResponseErrorHandlerFunc: httpx.ResponseErrorHandler(a.Logger),
	})

	return httpapi.HandlerWithOptions(strict, httpapi.ChiServerOptions{
		BaseRouter:       r,
		ErrorHandlerFunc: httpx.RequestErrorHandler,
	})
}

func (a *App) healthHandler(w http.ResponseWriter, r *http.Request) {
	dbOK := a.DB.Healthy(r.Context())
	status := "ok"
	dbStatus := "ok"
	if !dbOK {
		status = "degraded"
		dbStatus = "error"
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if !dbOK {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      status,
		"version":     "1.0.0",
		"database":    dbStatus,
		"ai_provider": a.Parser.Name(),
	})
}
