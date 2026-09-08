package readapi

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

// AdminUsageOverview 返回使用概览。
func (a *ReadAPI) AdminUsageOverview(ctx context.Context,
	req adminapi.AdminUsageOverviewRequestObject) (adminapi.AdminUsageOverviewResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)

	var users dbgen.AdminDashboardUsersRow
	var usage dbgen.AdminDashboardUsageRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		users, err = q.AdminDashboardUsers(ctx, dbgen.AdminDashboardUsersParams{
			Tz: a.cfg.ReportingTimezone, FromDate: from, ToDate: to,
		})
		if err != nil {
			return err
		}
		usage, err = q.AdminDashboardUsage(ctx, dbgen.AdminDashboardUsageParams{
			FromDate: from, ToDate: to,
		})
		return err
	})
	if err != nil {
		a.logger.Error("使用概览取数失败", "error", err)
		return adminapi.AdminUsageOverview500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	return adminapi.AdminUsageOverview200JSONResponse(adminapi.UsageOverviewResponse{
		Data: adminapi.UsageOverview{
			Range: adminapi.DateRange{
				From: dateOf(from), To: dateOf(to), Timezone: a.cfg.ReportingTimezone,
			},
			Dau: int(users.Dau), Wau: int(users.Wau), Mau: int(users.Mau),
			FeatureUsage: []adminapi.FeatureUsage{
				{Feature: "capture", Events: int(usage.CaptureSubmitted)},
				{Feature: "assistant", Events: int(usage.AssistantTurns)},
				{Feature: "task", Events: int(usage.TaskCompleted)},
			},
		},
		Freshness: a.freshness(ctx),
		Meta:      meta(ctx),
	}), nil
}

// AdminGetFunnel 返回漏斗。
//
// 每一步都给出「有多少人」与「多少次」。**分母为 0 时转化率返回空**，
// 界面显示「—」而不是 0%——没有样本和转化率为零是两回事，
// 后者会让人以为这一步把所有人都挡住了。
func (a *ReadAPI) AdminGetFunnel(ctx context.Context,
	req adminapi.AdminGetFunnelRequestObject) (adminapi.AdminGetFunnelResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)
	funnel := string(req.Funnel)

	var steps []adminapi.FunnelStep
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		usage, err := q.AdminDashboardUsage(ctx, dbgen.AdminDashboardUsageParams{
			FromDate: from, ToDate: to,
		})
		if err != nil {
			return err
		}

		switch funnel {
		case "onboarding":
			cohort, err := q.AdminOnboardingCohort(ctx, dbgen.AdminOnboardingCohortParams{Tz: a.cfg.ReportingTimezone, FromDate: from, ToDate: to})
			if err != nil {
				return err
			}
			steps = buildFunnel([]rawStep{
				{"期间注册", cohort.Registered, cohort.Registered},
				{"当前已完成初始化", cohort.Initialized, cohort.Initialized},
				{"期间有业务操作", cohort.Activated, cohort.Activated},
			})
		case "capture":
			steps = buildFunnel([]rawStep{
				{"提交", usage.CaptureSubmitted, usage.CaptureSubmitted},
				{"确认", usage.CaptureConfirmed, usage.CaptureConfirmed},
			})
		default: // assistant
			steps = buildFunnel([]rawStep{
				{"提交", usage.AssistantTurns, usage.AssistantTurns},
			})
		}
		return nil
	})
	if err != nil {
		a.logger.Error("漏斗取数失败", "funnel", funnel, "error", err)
		return adminapi.AdminGetFunnel500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	return adminapi.AdminGetFunnel200JSONResponse(adminapi.FunnelResponse{
		Funnel: funnel, Data: steps,
		Freshness: a.freshness(ctx), Meta: meta(ctx),
	}), nil
}

type rawStep struct {
	name   string
	users  int64
	events int64
}

// buildFunnel 算各步的转化率。
func buildFunnel(raw []rawStep) []adminapi.FunnelStep {
	out := make([]adminapi.FunnelStep, 0, len(raw))
	if len(raw) == 0 {
		return out
	}
	start := raw[0].users
	for i, step := range raw {
		item := adminapi.FunnelStep{
			Name: step.name, Users: int(step.users), Events: int(step.events),
		}
		// 分母为 0 时留空，不写 0。
		item.ConversionFromStart = ratio(step.users, start)
		if i > 0 {
			item.ConversionFromPrevious = ratio(step.users, raw[i-1].users)
		}
		out = append(out, item)
	}
	return out
}

// AdminListAuditLogs 返回管理操作审计。
func (a *ReadAPI) AdminListAuditLogs(ctx context.Context,
	req adminapi.AdminListAuditLogsRequestObject) (adminapi.AdminListAuditLogsResponseObject, error) {

	body, err := a.auditLogs(ctx, nilIfEmpty(req.Params.Action), nil,
		req.Params.Cursor, req.Params.Limit)
	if err != nil {
		return adminapi.AdminListAuditLogs500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}
	return adminapi.AdminListAuditLogs200JSONResponse(body), nil
}

// AdminGetUserAdminActions 返回针对某个用户的管理记录。
func (a *ReadAPI) AdminGetUserAdminActions(ctx context.Context,
	req adminapi.AdminGetUserAdminActionsRequestObject) (adminapi.AdminGetUserAdminActionsResponseObject, error) {

	target := req.UserId
	body, err := a.auditLogs(ctx, nil, &target, req.Params.Cursor, req.Params.Limit)
	if err != nil {
		return adminapi.AdminGetUserAdminActions500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}
	return adminapi.AdminGetUserAdminActions200JSONResponse(body), nil
}

func (a *ReadAPI) auditLogs(ctx context.Context, action, targetID, cursor *string,
	limit *int) (adminapi.AdminAuditListResponse, error) {

	cursorTime, cursorID := decodeCursor(cursor)
	size := limitOf(limit)

	var rows []dbgen.AdminListAuditLogsRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		rows, err = q.AdminListAuditLogs(ctx, dbgen.AdminListAuditLogsParams{
			Action: action, TargetID: targetID,
			CursorTime: cursorTime, CursorID: cursorID,
			RowLimit: size + 1,
		})
		return err
	})
	if err != nil {
		a.logger.Error("审计列表取数失败", "error", err)
		return adminapi.AdminAuditListResponse{}, err
	}

	var nextCursor *string
	if len(rows) > int(size) {
		last := rows[size-1]
		token := encodeCursor(last.OccurredAt, last.ID)
		nextCursor = &token
		rows = rows[:size]
	}

	items := make([]adminapi.AdminAuditEntry, 0, len(rows))
	for _, r := range rows {
		items = append(items, adminapi.AdminAuditEntry{
			Id: r.ID, OccurredAt: r.OccurredAt,
			ActorUsername: r.ActorUsername, Action: r.Action,
			Outcome:    adminapi.AdminAuditEntryOutcome(r.Outcome),
			TargetType: r.TargetType, TargetId: r.TargetID,
			ReasonCode: r.ReasonCode, ReasonText: r.ReasonText,
			RequestId: r.RequestID,
		})
	}

	return adminapi.AdminAuditListResponse{
		Data: items, Page: adminapi.PageInfo{NextCursor: nextCursor}, Meta: meta(ctx),
	}, nil
}
