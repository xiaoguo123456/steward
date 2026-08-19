// Package httpx 提供 HTTP 中间件、请求上下文与统一错误响应。
package httpx

import (
	"context"

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
