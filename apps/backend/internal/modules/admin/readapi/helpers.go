package readapi

import (
	"encoding/base64"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

type openapiDate = openapi_types.Date

func dateOf(t time.Time) openapi_types.Date {
	return openapi_types.Date{Time: t}
}

func loadLocation(name string) *time.Location {
	return timeutil.LoadLocation(name)
}

// money 把「金额字符串 + 状态」映射成契约里的 MoneyAmount。
//
// **状态是 pricing_missing 时金额必须为空**，界面显示「价格缺失」而不是 0。
// 这条是整个成本链路最要紧的一条：0 会被读成「这次不花钱」，
// 而实际情况是「我们不知道花了多少」。
func money(amount string, status string) adminapi.MoneyAmount {
	out := adminapi.MoneyAmount{
		Currency: adminapi.USD,
		Status:   adminapi.CostStatus(statusOr(status)),
	}
	// 空串表示「算不出来」。有金额就带上——即使状态是 partial：
	// 那部分钱是真实花掉的，丢掉它账目会凭空少一块。
	if trimmed := strings.TrimSpace(amount); trimmed != "" {
		out.Amount = &trimmed
	}
	return out
}

func statusOr(status string) string {
	if strings.TrimSpace(status) == "" {
		return "no_usage"
	}
	return status
}

// encodeCursor 把游标编码成不透明字符串。
//
// 编码不是为了保密，是为了**让客户端没法解析它**：一旦有人开始拼游标，
// 分页的实现就再也改不动了。
func encodeCursor(t time.Time, id string) string {
	raw := t.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeCursor 解析游标。解析不了就当没有游标，从头开始。
//
// 报错也可以，但游标是客户端原样回传的，报错只会让一个能自愈的场景
// 变成一个卡住的页面。
func decodeCursor(cursor *string) (*time.Time, *string) {
	if cursor == nil || *cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(*cursor)
	if err != nil {
		return nil, nil
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, nil
	}
	return &parsed, &parts[1]
}

// limitOf 规整每页条数。默认 20，上限 100。
func limitOf(limit *int) int32 {
	if limit == nil || *limit <= 0 {
		return 20
	}
	if *limit > 100 {
		return 100
	}
	return int32(*limit)
}

// nilIfEmpty 把空串转成 nil，方便传给 sqlc 的可空参数。
func nilIfEmpty(v *string) *string {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil
	}
	return v
}

// ratio 算比率，分母为 0 时返回 nil。
//
// **不返回 0。** 「没有样本」和「转化率为零」是两回事，
// 显示成 0% 会让人以为这一步把所有人都挡住了。
func ratio(numerator, denominator int64) *float64 {
	if denominator == 0 {
		return nil
	}
	value := float64(numerator) / float64(denominator)
	return &value
}
