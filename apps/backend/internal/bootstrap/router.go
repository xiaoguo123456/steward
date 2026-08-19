package bootstrap

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage/localfs"
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

	// 本地存储的传输端点。它是存储驱动的实现细节而不是产品 API：
	// 客户端只按签名 URL 收发字节，不关心背后是 OSS 还是本地磁盘。
	if a.LocalStore != nil {
		r.Put(localfs.TransportPrefix+"*", a.localUploadHandler)
		r.Get(localfs.TransportPrefix+"*", a.localDownloadHandler)
	}

	strict := httpapi.NewStrictHandlerWithOptions(a.Server, nil, httpapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  httpx.RequestErrorHandler,
		ResponseErrorHandlerFunc: httpx.ResponseErrorHandler(a.Logger),
	})

	return httpapi.HandlerWithOptions(strict, httpapi.ChiServerOptions{
		BaseRouter:       r,
		ErrorHandlerFunc: httpx.RequestErrorHandler,
	})
}

// localUploadHandler 接收本地存储驱动的直传请求。
func (a *App) localUploadHandler(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, localfs.TransportPrefix)
	query := r.URL.Query()

	if err := a.LocalStore.VerifySignature(key, http.MethodPut, query.Get("exp"), query.Get("sig")); err != nil {
		http.Error(w, "签名无效或已过期", http.StatusForbidden)
		return
	}

	limit := storage.MaxBytesFor(r.Header.Get("Content-Type"))
	if _, err := a.LocalStore.Write(key, r.Body, limit); err != nil {
		a.Logger.Warn("本地存储写入失败", "key", key, "error", err)
		http.Error(w, "写入失败", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// localDownloadHandler 提供本地存储驱动的只读访问。
func (a *App) localDownloadHandler(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, localfs.TransportPrefix)
	query := r.URL.Query()

	if err := a.LocalStore.VerifySignature(key, http.MethodGet, query.Get("exp"), query.Get("sig")); err != nil {
		http.Error(w, "签名无效或已过期", http.StatusForbidden)
		return
	}

	reader, err := a.LocalStore.Open(r.Context(), key)
	if err != nil {
		http.Error(w, "文件不存在", http.StatusNotFound)
		return
	}
	defer reader.Close()

	w.Header().Set("Cache-Control", "private, no-store")
	if _, err := io.Copy(w, reader); err != nil {
		a.Logger.Warn("本地存储读取失败", "key", key, "error", err)
	}
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
		"storage":     a.Store.Name(),
	})
}
