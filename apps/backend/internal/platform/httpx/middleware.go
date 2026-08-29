package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// publicPaths 是不要求认证的路径。除此之外一律要求 Bearer Token。
var publicPaths = []string{
	"/v1/auth/phone-code",
	"/v1/auth/login",
	"/v1/auth/refresh",
	"/healthz",
}

// publicPrefixes 是按前缀放行的路径。
// 本地存储的传输端点用签名 URL 自证身份，不走 Bearer Token。
var publicPrefixes = []string{"/media/local/"}

// RequestIDMiddleware 为每个请求生成追踪 ID，并回写到响应头。
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := idgen.New(idgen.PrefixRequest)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
	})
}

// PrivateCacheMiddleware 让所有响应默认不被缓存。
// 用户内容是私有数据，不允许被中间层或浏览器缓存。
func PrivateCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware 按白名单放行跨域请求。
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && slices.Contains(allowedOrigins, origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers",
					"Authorization, Content-Type, Idempotency-Key, If-Match, Deletion-Status-Token")
				w.Header().Set("Access-Control-Allow-Methods",
					"GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Expose-Headers", "X-Request-Id, ETag")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware 校验 Bearer Token 并把用户 ID 写入上下文。
//
// 客户端自报的任何身份信息都被忽略：用户 ID 只来自服务端验证过的令牌。
type AccountStateChecker func(context.Context, string) (bool, error)

func AuthMiddleware(tokens *auth.TokenService, accountActive AccountStateChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isPublicRequest(r) {
				next.ServeHTTP(w, r)
				return
			}

			raw := strings.TrimSpace(r.Header.Get("Authorization"))
			if !strings.HasPrefix(raw, "Bearer ") {
				WriteError(w, r, apperr.New(apperr.CodeUnauthenticated))
				return
			}

			userID, err := tokens.ParseAccessToken(strings.TrimPrefix(raw, "Bearer "))
			if err != nil {
				WriteError(w, r, apperr.New(apperr.CodeUnauthenticated))
				return
			}
			if !bypassAccountStateCheck(r) && accountActive != nil {
				active, err := accountActive(r.Context(), userID)
				if err != nil {
					WriteError(w, r, apperr.Internal(err))
					return
				}
				if !active {
					WriteError(w, r, apperr.New(apperr.CodeAccountNotActive))
					return
				}
			}

			ctx := WithUserID(r.Context(), userID)
			if key := strings.TrimSpace(r.Header.Get("Idempotency-Key")); key != "" {
				ctx = WithIdempotencyKey(ctx, key)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RecovererMiddleware 把 panic 转成 500，避免整个进程退出。
func RecovererMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("请求处理发生 panic",
						"panic", rec,
						"path", r.URL.Path,
						"request_id", RequestID(r.Context()),
						"stack", string(debug.Stack()))
					WriteError(w, r, apperr.New(apperr.CodeInternal))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func isPublicRequest(r *http.Request) bool {
	path := r.URL.Path
	if slices.Contains(publicPaths, path) {
		return true
	}
	for _, prefix := range publicPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/account-deletions/") {
		return true
	}
	return false
}

// 删除提交允许同一个尚未过期的 Access Token 做严格幂等重放；
// 它仍需要有效 JWT，且只放行这一条路径，不恢复任何普通账号权限。
func bypassAccountStateCheck(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == "/v1/me/account-deletion"
}

// WriteError 按契约结构输出错误响应。
//
// 未识别的错误一律降级为 INTERNAL_ERROR，不把内部细节暴露给客户端。
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	appErr, ok := apperr.As(err)
	if !ok {
		appErr = apperr.Internal(err)
	}

	body := httpapi.ErrorResponse{
		Error: httpapi.ErrorBody{
			Code:         httpapi.ErrorCode(appErr.Code),
			Message:      appErr.Message,
			Retryable:    appErr.Retryable(),
			ReloadTarget: &appErr.ReloadTarget,
		},
		Meta: httpapi.ResponseMeta{RequestId: RequestID(r.Context())},
	}
	if len(appErr.Fields) > 0 {
		details := make([]httpapi.ErrorDetail, 0, len(appErr.Fields))
		for _, f := range appErr.Fields {
			details = append(details, httpapi.ErrorDetail{Field: f.Field, Message: f.Message})
		}
		body.Error.Details = &details
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(appErr.HTTPStatus())
	_ = json.NewEncoder(w).Encode(body)
}

// RequestErrorHandler 处理生成代码在参数绑定阶段产生的错误。
func RequestErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	// 缺少 Idempotency-Key 有专门的错误码，App 据此提示重试。
	if strings.Contains(err.Error(), "Idempotency-Key") {
		WriteError(w, r, apperr.New(apperr.CodeIdempotencyKeyReq))
		return
	}
	WriteError(w, r, apperr.Newf(apperr.CodeValidationFailed, "请求参数不合法：%s", err.Error()))
}

// ResponseErrorHandler 处理 Handler 返回的错误。
func ResponseErrorHandler(logger *slog.Logger) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		if appErr, ok := apperr.As(err); ok {
			if appErr.Code == apperr.CodeInternal {
				logger.Error("内部错误", "error", err, "path", r.URL.Path,
					"request_id", RequestID(r.Context()))
			}
			WriteError(w, r, appErr)
			return
		}
		logger.Error("未分类错误", "error", err, "path", r.URL.Path,
			"request_id", RequestID(r.Context()))
		WriteError(w, r, apperr.New(apperr.CodeInternal))
	}
}
