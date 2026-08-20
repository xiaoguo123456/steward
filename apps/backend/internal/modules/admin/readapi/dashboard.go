// Package readapi 实现后台的只读接口。
//
// **所有跨用户的数据都来自 admin schema 的脱敏读模型**，一行业务表都不碰。
// 业务表受 RLS 约束：没有身份读不出来，有身份又只能看一个人。
// 读模型正是为这个矛盾存在的。
//
// 代价是数据有延迟，所以每个响应都带 freshness——**不标出来的话，
// 一个还没聚合的今天会被读成「今天没人用」**，那是最容易让人做出
// 错误判断的一种错。
package readapi

import (
	"context"
	"log/slog"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ReadAPI 实现后台的只读操作。
type ReadAPI struct {
	db     *database.DB
	cfg    config.AdminConfig
	logger *slog.Logger
	// phoneKey 用于按手机号精确查询时算 HMAC。
	phoneKey []byte
}

// NewAPI 构造只读 ReadAPI。
func NewReadAPI(db *database.DB, cfg config.AdminConfig, phoneKey []byte, logger *slog.Logger) *ReadAPI {
	if logger == nil {
		logger = slog.Default()
	}
	return &ReadAPI{db: db, cfg: cfg, phoneKey: phoneKey, logger: logger}
}

// AdminDashboardSummary 返回总览。
//
// 四个模块分别取数，**某一个失败时保留其余的**并在 failed_sections 里标出来。
// 整页报错的话，一个模块查不出来会让运营连用户数都看不到。
func (a *ReadAPI) AdminDashboardSummary(ctx context.Context,
	req adminapi.AdminDashboardSummaryRequestObject) (adminapi.AdminDashboardSummaryResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)
	tz := a.cfg.ReportingTimezone

	out := adminapi.DashboardSummary{
		Range:          adminapi.DateRange{From: dateOf(from), To: dateOf(to), Timezone: tz},
		FailedSections: &[]string{},
	}
	failed := []string{}

	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		if users, err := q.AdminDashboardUsers(ctx, dbgen.AdminDashboardUsersParams{
			Tz: tz, FromDate: from, ToDate: to,
		}); err == nil {
			out.Users = adminapi.UserMetrics{
				Total: int(users.Total), NewUsers: int(users.NewUsers),
				Initialized: int(users.Initialized),
				Dau:         int(users.Dau), Wau: int(users.Wau), Mau: int(users.Mau),
			}
		} else {
			a.logger.Error("总览：用户口径取数失败", "error", err)
			failed = append(failed, "users")
		}

		if usage, err := q.AdminDashboardUsage(ctx, dbgen.AdminDashboardUsageParams{
			FromDate: from, ToDate: to,
		}); err == nil {
			out.Usage = adminapi.UsageMetrics{
				CaptureSubmitted: int(usage.CaptureSubmitted),
				CaptureConfirmed: int(usage.CaptureConfirmed),
				AssistantTurns:   int(usage.AssistantTurns),
				TaskCompleted:    int(usage.TaskCompleted),
			}
		} else {
			a.logger.Error("总览：使用口径取数失败", "error", err)
			failed = append(failed, "usage")
		}

		if ai, err := q.AdminDashboardAI(ctx, dbgen.AdminDashboardAIParams{
			FromDate: from, ToDate: to,
		}); err == nil {
			out.Ai = adminapi.AIMetrics{
				InputTokens:  int(ai.InputTokens),
				OutputTokens: int(ai.OutputTokens),
				// **缺价的调用数要单列出来。** 它不为 0 时上面那个金额一定偏低，
				// 界面必须让人看见这一点，否则会把一个不完整的数当成账单。
				PricingMissingCalls: int(ai.PricingMissingDays),
				Cost:                money(ai.Cost, ai.CostStatus),
			}
		} else {
			a.logger.Error("总览：AI 口径取数失败", "error", err)
			failed = append(failed, "ai")
		}
		return nil
	})
	if err != nil {
		return adminapi.AdminDashboardSummary500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	// 运行状态来自队列，和聚合无关，单独取。
	if runtime, err := a.runtimeMetrics(ctx); err == nil {
		out.Runtime = runtime
	} else {
		a.logger.Error("总览：运行状态取数失败", "error", err)
		failed = append(failed, "runtime")
	}

	out.Freshness = a.freshness(ctx)
	out.FailedSections = &failed
	return adminapi.AdminDashboardSummary200JSONResponse(adminapi.DashboardSummaryResponse{
		Data: out, Meta: meta(ctx),
	}), nil
}

// AdminDashboardTrends 返回按天的趋势。
func (a *ReadAPI) AdminDashboardTrends(ctx context.Context,
	req adminapi.AdminDashboardTrendsRequestObject) (adminapi.AdminDashboardTrendsResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)

	var rows []dbgen.AdminDashboardTrendsRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		rows, err = q.AdminDashboardTrends(ctx, dbgen.AdminDashboardTrendsParams{
			FromDate: from, ToDate: to,
		})
		return err
	})
	if err != nil {
		a.logger.Error("趋势取数失败", "error", err)
		return adminapi.AdminDashboardTrends500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	points := make([]adminapi.TrendPoint, 0, len(rows))
	for _, r := range rows {
		cost := money(r.AiCost, r.CostStatus)
		points = append(points, adminapi.TrendPoint{
			Date:             dateOf(r.ReportDate),
			ActiveUsers:      int(r.ActiveUsers),
			CaptureSubmitted: int(r.CaptureSubmitted),
			AssistantTurns:   int(r.AssistantTurns),
			// AI 调用次数用 Assistant 轮次近似——日聚合里没有单独存调用数，
			// 而按功能拆分的精确数字在 AI 成本页有。这里是趋势不是账单。
			AiCalls: int(r.AssistantTurns),
			AiCost:  &cost,
		})
	}

	freshness := a.freshness(ctx)
	return adminapi.AdminDashboardTrends200JSONResponse(adminapi.DashboardTrendsResponse{
		Data: points, Freshness: freshness, Meta: meta(ctx),
	}), nil
}

// resolveRange 解析时间范围，默认最近 7 天。
//
// 上界不许超过今天：查未来只会得到空数据，而空数据在界面上和
// 「这段时间没人用」长得一模一样。
func (a *ReadAPI) resolveRange(from, to *openapiDate) (time.Time, time.Time) {
	loc := loadLocation(a.cfg.ReportingTimezone)
	today := time.Now().In(loc).Truncate(24 * time.Hour)

	end := today
	if to != nil {
		end = to.Time
	}
	if end.After(today) {
		end = today
	}
	start := end.AddDate(0, 0, -6)
	if from != nil {
		start = from.Time
	}
	if start.After(end) {
		start = end
	}
	return start, end
}

// freshness 返回读模型的新鲜度。
func (a *ReadAPI) freshness(ctx context.Context) adminapi.DataFreshness {
	out := adminapi.DataFreshness{AggregationStatus: adminapi.DataFreshnessAggregationStatusPending}

	var row dbgen.AdminLatestAggregationRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		row, err = q.AdminLatestAggregation(ctx, "daily_usage")
		return err
	})
	if err != nil {
		// 一次都没跑过。返回 pending 而不是假装数据是新的。
		return out
	}

	out.DataAsOf = row.DataAsOf
	switch {
	case row.Status == "failed":
		out.AggregationStatus = adminapi.DataFreshnessAggregationStatusFailed
	case row.DataAsOf == nil:
		out.AggregationStatus = adminapi.DataFreshnessAggregationStatusPending
	case time.Since(*row.DataAsOf) > 2*time.Hour:
		// 聚合是每小时一次，超过两小时说明它停了。
		// 这时数据还能看，但必须标成陈旧——不然运营会拿两天前的数字做决定。
		out.AggregationStatus = adminapi.DataFreshnessAggregationStatusStale
	default:
		out.AggregationStatus = adminapi.DataFreshnessAggregationStatusFresh
	}
	return out
}

func meta(ctx context.Context) adminapi.ResponseMeta {
	return adminapi.ResponseMeta{RequestId: httpx.RequestID(ctx)}
}

func errorBody(ctx context.Context, code adminapi.ErrorCode, message string) adminapi.ErrorResponse {
	return adminapi.ErrorResponse{
		Error: adminapi.Error{Code: code, Message: message},
		Meta:  meta(ctx),
	}
}
