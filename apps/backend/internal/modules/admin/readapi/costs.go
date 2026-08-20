package readapi

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// AdminAICostSummary 返回 AI 成本汇总。
func (a *ReadAPI) AdminAICostSummary(ctx context.Context,
	req adminapi.AdminAICostSummaryRequestObject) (adminapi.AdminAICostSummaryResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)

	var row dbgen.AdminDashboardAIRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		row, err = q.AdminDashboardAI(ctx, dbgen.AdminDashboardAIParams{FromDate: from, ToDate: to})
		return err
	})
	if err != nil {
		a.logger.Error("成本汇总取数失败", "error", err)
		return adminapi.AdminAICostSummary500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	return adminapi.AdminAICostSummary200JSONResponse(adminapi.AICostSummaryResponse{
		Data: adminapi.AICostSummary{
			Range: adminapi.DateRange{
				From: dateOf(from), To: dateOf(to), Timezone: a.cfg.ReportingTimezone,
			},
			InputTokens:       int(row.InputTokens),
			CachedInputTokens: int(row.CachedInputTokens),
			OutputTokens:      int(row.OutputTokens),
			Cost:              money(row.Cost, row.CostStatus),
			// 失败调用的成本要单列。**失败也可能花钱**——模型算了一半才报错，
			// 那部分照样计费；不单列会让人以为失败是免费的。
			// 读模型按天聚合时没有分成功失败，因此这里给的是「还没拆出来」。
			FailedCost: adminapi.MoneyAmount{
				Currency: adminapi.USD,
				Status:   adminapi.CostStatus(adminapi.CostStatusPending),
			},
			PricingMissingCalls: int(row.PricingMissingDays),
			// 调用数与成功率要按 ai_actions 聚合，而那张表受 RLS 约束。
			// **返回空而不是 0**：0% 成功率会被当成「全都失败了」。
			Calls:       0,
			SuccessRate: nil,
			Latency:     adminapi.LatencyPercentiles{},
		},
		Meta: meta(ctx),
	}), nil
}

// AdminAICostBreakdown 按日期分组返回成本。
//
// 契约允许按 feature / provider / model 分组，但读模型是按「用户 + 日期」
// 聚合的，拆不出后三者。**这里只实现按日期**，其余分组明确报错而不是
// 返回一份看起来正常的错数据。
func (a *ReadAPI) AdminAICostBreakdown(ctx context.Context,
	req adminapi.AdminAICostBreakdownRequestObject) (adminapi.AdminAICostBreakdownResponseObject, error) {

	groupBy := "date"
	if req.Params.GroupBy != nil {
		groupBy = string(*req.Params.GroupBy)
	}
	if groupBy != "date" {
		return adminapi.AdminAICostBreakdown400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(errorBody(ctx,
				adminapi.ADMINVALIDATIONFAILED,
				"目前只支持按日期分组：读模型按「用户 + 日期」聚合，拆不出功能与模型维度。")),
		}, nil
	}

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
		a.logger.Error("成本分组取数失败", "error", err)
		return adminapi.AdminAICostBreakdown500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	items := make([]adminapi.AICostBreakdownRow, 0, len(rows))
	for _, r := range rows {
		items = append(items, adminapi.AICostBreakdownRow{
			GroupKey: r.ReportDate.Format("2006-01-02"),
			Calls:    int(r.AssistantTurns),
			Cost:     money(r.AiCost, r.CostStatus),
		})
	}

	return adminapi.AdminAICostBreakdown200JSONResponse(adminapi.AICostBreakdownResponse{
		Data: items, GroupBy: groupBy, Meta: meta(ctx),
	}), nil
}

// AdminGetUserCosts 返回某个用户的成本明细。
//
// 这是唯一能看到按功能与模型拆分的地方——因为它在该用户的 RLS 事务里，
// 可以直接读 ai_actions。跨用户就没有这个可能，那正是设计要的。
func (a *ReadAPI) AdminGetUserCosts(ctx context.Context,
	req adminapi.AdminGetUserCostsRequestObject) (adminapi.AdminGetUserCostsResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)

	type row struct {
		Date                                    time.Time
		Feature, Provider, Model                string
		InputTokens, CachedTokens, OutputTokens int64
		Calls                                   int64
		Cost                                    string
		CostStatus                              string
		PricingMissing                          int64
	}
	var rows []row

	err := a.db.InTx(ctx, req.UserId, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		result, err := tx.Query(ctx, `
			SELECT (created_at AT TIME ZONE $1)::date,
			       feature, provider, provider_model,
			       coalesce(sum(input_tokens), 0)::bigint,
			       coalesce(sum(cached_input_tokens), 0)::bigint,
			       coalesce(sum(output_tokens), 0)::bigint,
			       count(*)::bigint,
			       coalesce((sum(estimated_cost)
			           FILTER (WHERE cost_status IN ('calculated','partial')))::text, ''),
			       CASE
			           -- 全是「这次没用到这个单位」时是 not_applicable，
			           -- 不是 calculated——后者配上空金额，看起来像算错了。
			           WHEN count(*) FILTER (WHERE cost_status <> 'not_applicable') = 0
			               THEN 'not_applicable'
			           WHEN count(*) FILTER (WHERE cost_status IN ('pricing_missing','partial')) = 0
			               THEN 'calculated'
			           WHEN count(*) FILTER (WHERE cost_status IN ('calculated','partial')) = 0
			               THEN 'pricing_missing'
			           ELSE 'partial'
			       END,
			       count(*) FILTER (WHERE cost_status IN ('pricing_missing','partial'))::bigint
			  FROM ai_actions
			 WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2 AND $3
			 GROUP BY 1, 2, 3, 4
			 ORDER BY 1 DESC, 2`, a.cfg.ReportingTimezone, from, to)
		if err != nil {
			return err
		}
		defer result.Close()
		for result.Next() {
			var r row
			if err := result.Scan(&r.Date, &r.Feature, &r.Provider, &r.Model,
				&r.InputTokens, &r.CachedTokens, &r.OutputTokens, &r.Calls,
				&r.Cost, &r.CostStatus, &r.PricingMissing); err != nil {
				return err
			}
			rows = append(rows, r)
		}
		return result.Err()
	})
	if err != nil {
		a.logger.Error("用户成本取数失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminGetUserCosts500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	items := make([]adminapi.UserCostRow, 0, len(rows))
	anyMissing := false
	for _, r := range rows {
		missing := int(r.PricingMissing)
		if missing > 0 {
			anyMissing = true
		}
		items = append(items, adminapi.UserCostRow{
			Date: dateOf(r.Date), Feature: r.Feature,
			Provider: r.Provider, Model: r.Model,
			InputTokens: int(r.InputTokens), CachedInputTokens: int(r.CachedTokens),
			OutputTokens: int(r.OutputTokens), Calls: int(r.Calls),
			Cost:                money(r.Cost, r.CostStatus),
			PricingMissingCalls: &missing,
		})
	}

	// 合计的状态要保守：**只要有一行缺价，合计就是 partial**，
	// 不能报成 calculated——那会让一个偏低的数字看起来是准的。
	total := a.totalOf(items, anyMissing)

	return adminapi.AdminGetUserCosts200JSONResponse(adminapi.UserCostResponse{
		Data: items, Total: total, Meta: meta(ctx),
	}), nil
}

// totalOf 汇总各行金额。
//
// 汇总在 Go 里做只能做加法，而加法必须用精确十进制——所以这里用
// costs 包的 numeric 工具，不用 float64。
func (a *ReadAPI) totalOf(rows []adminapi.UserCostRow, anyMissing bool) adminapi.MoneyAmount {
	status := "calculated"
	if anyMissing {
		status = "partial"
	}
	if len(rows) == 0 {
		return adminapi.MoneyAmount{Currency: adminapi.USD, Status: adminapi.CostStatus("no_usage")}
	}

	sum, ok := costs.SumAmounts(amountsOf(rows))
	if !ok {
		return adminapi.MoneyAmount{Currency: adminapi.USD, Status: adminapi.CostStatus(status)}
	}
	return adminapi.MoneyAmount{
		Amount: &sum, Currency: adminapi.USD, Status: adminapi.CostStatus(status),
	}
}

func amountsOf(rows []adminapi.UserCostRow) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Cost.Amount != nil {
			out = append(out, *r.Cost.Amount)
		}
	}
	return out
}
