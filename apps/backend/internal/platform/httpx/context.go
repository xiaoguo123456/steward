// Package httpx 提供 HTTP 中间件、请求上下文与统一错误响应。
package httpx

import (
	"context"
	"net/http"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

type contextKey int

const (
	contextKeyUserID contextKey = iota
	contextKeyRequestID
	contextKeyIdempotencyKey
)

// WithUserID 把已认证的用户 ID 放入上下文。
// 只有 Auth 中间件在验证令牌之后才会调用它，业务层不得自行注入。
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, contextKeyUserID, userID)
}

// UserID 取出当前用户 ID。未认证时返回 UNAUTHENTICATED 错误。
func UserID(ctx context.Context) (string, error) {
	id, _ := ctx.Value(contextKeyUserID).(string)
	if id == "" {
		return "", apperr.New(apperr.CodeUnauthenticated)
	}
	return id, nil
}

// WithRequestID 把请求追踪 ID 放入上下文。
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKeyRequestID, id)
}

// RequestID 取出请求追踪 ID。
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(contextKeyRequestID).(string)
	return id
}

// WithIdempotencyKey 保存本次请求的幂等键。
func WithIdempotencyKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, contextKeyIdempotencyKey, key)
}

// IdempotencyKey 取出本次请求的幂等键。
func IdempotencyKey(ctx context.Context) string {
	key, _ := ctx.Value(contextKeyIdempotencyKey).(string)
	return key
}

// contextKeyRequest 让 strict server 的 handler 拿得到原始请求。
//
// 大多数 handler 不该需要它——能从契约拿到的东西就该从契约拿。
// 但登录要看 Origin 和来源 IP，这两样不在请求体里，也不该塞进契约：
// 它们是传输层的事实，不是接口的参数。
type requestContextKey struct{}

// WithRequest 把原始请求放进上下文。
func WithRequest(ctx context.Context, r *http.Request) context.Context {
	return context.WithValue(ctx, requestContextKey{}, r)
}

// RequestFrom 取出原始请求，没有时返回 nil。
func RequestFrom(ctx context.Context) *http.Request {
	r, _ := ctx.Value(requestContextKey{}).(*http.Request)
	return r
}

// RequestMiddleware 把请求塞进上下文。挂在链路最外层。
func RequestMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(WithRequest(r.Context(), r)))
	})
}
