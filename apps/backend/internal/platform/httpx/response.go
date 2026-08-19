package httpx

import (
	"context"
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// Meta 构造成功响应的元信息。
func Meta(ctx context.Context) httpapi.ResponseMeta {
	return httpapi.ResponseMeta{RequestId: RequestID(ctx)}
}

// DefaultPageLimit 与 MaxPageLimit 对应契约中 limit 参数的默认值与上界。
const (
	DefaultPageLimit = 20
	MaxPageLimit     = 100
)

// PageLimit 归一化分页大小。
func PageLimit(limit *int) int32 {
	if limit == nil || *limit <= 0 {
		return DefaultPageLimit
	}
	if *limit > MaxPageLimit {
		return MaxPageLimit
	}
	return int32(*limit)
}

// Cursor 是键集分页游标的解码结果。
// 游标对客户端不透明，服务端负责编解码，客户端不得解析其内容。
type Cursor struct {
	Time time.Time
	ID   string
}

// EncodeCursor 把排序键编码成不透明游标。
func EncodeCursor(t time.Time, id string) string {
	raw := t.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor 解析游标。非法游标按参数错误处理，而不是静默忽略，
// 否则客户端会拿到从头开始的一页并误以为是下一页。
func DecodeCursor(raw *string) (*Cursor, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(*raw)
	if err != nil {
		return nil, apperr.Newf(apperr.CodeValidationFailed, "分页游标不合法")
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 {
		return nil, apperr.Newf(apperr.CodeValidationFailed, "分页游标不合法")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, apperr.Newf(apperr.CodeValidationFailed, "分页游标不合法")
	}
	return &Cursor{Time: t, ID: parts[1]}, nil
}

// PageOf 根据实际返回条数与请求上限构造分页信息。
// 调用方应多查一条来判断是否还有下一页。
func PageOf(hasMore bool, nextCursor string) httpapi.PageInfo {
	info := httpapi.PageInfo{HasMore: hasMore}
	if hasMore && nextCursor != "" {
		info.NextCursor = &nextCursor
	}
	return info
}

// ParseVersion 把 If-Match 头解析成期望版本号。
//
// 未携带或格式不合法时返回 false，表示不做并发检查：
// 并发编辑场景应始终携带 If-Match，但单人顺序操作没有必要先读一次。
func ParseVersion(raw string) (int32, bool) {
	trimmed := strings.Trim(strings.TrimSpace(raw), `"`)
	if trimmed == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(trimmed, 10, 32)
	if err != nil {
		return 0, false
	}
	return int32(v), true
}

// ParseIfMatch 从可选的 If-Match 头取出期望版本。
func ParseIfMatch(raw *string) *int32 {
	if raw == nil {
		return nil
	}
	if v, ok := ParseVersion(*raw); ok {
		return &v
	}
	return nil
}

// Resource 构造一条受影响资源引用。id 为空表示该类型的集合查询整体失效。
func Resource(kind httpapi.AffectedResourceType, id string) httpapi.AffectedResource {
	res := httpapi.AffectedResource{Type: kind}
	if id != "" {
		res.Id = &id
	}
	return res
}

// Mutation 构造写操作的通用响应，携带需要失效的资源列表。
func Mutation(ctx context.Context, activityBatchID string, resources ...httpapi.AffectedResource) httpapi.MutationResponse {
	resp := httpapi.MutationResponse{Meta: Meta(ctx)}
	resp.Data.AffectedResources = resources
	if activityBatchID != "" {
		resp.Data.ActivityBatchId = &activityBatchID
	}
	return resp
}
