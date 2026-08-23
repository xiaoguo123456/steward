package httpx

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// RegisterHealthRoutes 同时注册 GET 与 HEAD 探针。
//
// 阿里云 ALB 默认可能使用 HEAD 做健康检查；只注册 GET 会返回 405，导致业务
// 服务明明正常却被服务器组判为不健康。两种方法必须经过同一个 Handler，避免
// 探针口径漂移。
func RegisterHealthRoutes(r chi.Router, path string, handler http.HandlerFunc) {
	r.Get(path, handler)
	r.Head(path, handler)
}
