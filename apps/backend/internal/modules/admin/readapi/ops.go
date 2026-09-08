package readapi

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// queueRow 是一个队列的状态。
type queueRow struct {
	Queue                     string
	Available, Running        int64
	Scheduled, Retryable      int64
	Discarded                 int64
	OldestAvailableAgeSeconds *int64
}

// queueStatus 读 River 的任务表。
//
// 手写 pgx 是因为 river_job 由 River 在运行时自建、不在迁移里，
// sqlc 的 schema 推导看不到它。
func (a *ReadAPI) queueStatus(ctx context.Context) ([]queueRow, error) {
	var out []queueRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT queue,
			       count(*) FILTER (WHERE state = 'available'),
			       count(*) FILTER (WHERE state = 'running'),
			       count(*) FILTER (WHERE state = 'scheduled'),
			       count(*) FILTER (WHERE state = 'retryable'),
			       count(*) FILTER (WHERE state = 'discarded'),
			       -- 最老的待执行任务等了多久。**这是队列健康最直接的指标**：
			       -- 任务数不高但等了两小时，说明消费侧停了。
			       extract(epoch FROM (now() - min(scheduled_at)
			           FILTER (WHERE state = 'available')))::bigint
			  FROM river_job GROUP BY queue ORDER BY queue`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r queueRow
			if err := rows.Scan(&r.Queue, &r.Available, &r.Running, &r.Scheduled,
				&r.Retryable, &r.Discarded, &r.OldestAvailableAgeSeconds); err != nil {
				return err
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	return out, err
}

// AdminGetQueues 返回队列状态。
func (a *ReadAPI) AdminGetQueues(ctx context.Context,
	_ adminapi.AdminGetQueuesRequestObject) (adminapi.AdminGetQueuesResponseObject, error) {

	rows, err := a.queueStatus(ctx)
	if err != nil {
		a.logger.Error("队列状态取数失败", "error", err)
		return adminapi.AdminGetQueues500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	items := make([]adminapi.QueueStatus, 0, len(rows))
	for _, r := range rows {
		item := adminapi.QueueStatus{
			Queue: r.Queue, Available: int(r.Available), Running: int(r.Running),
			Scheduled: int(r.Scheduled), Retryable: int(r.Retryable),
			Discarded: int(r.Discarded),
		}
		if r.OldestAvailableAgeSeconds != nil {
			age := int(*r.OldestAvailableAgeSeconds)
			item.OldestAvailableAgeSeconds = &age
		}
		items = append(items, item)
	}

	return adminapi.AdminGetQueues200JSONResponse(adminapi.QueueStatusResponse{
		Data: items, Meta: meta(ctx),
	}), nil
}

// runtimeMetrics 给总览用的运行状态。
func (a *ReadAPI) runtimeMetrics(ctx context.Context) (adminapi.RuntimeMetrics, error) {
	out := adminapi.RuntimeMetrics{}
	rows, err := a.queueStatus(ctx)
	if err != nil {
		return out, err
	}
	for _, r := range rows {
		out.QueueAvailable += int(r.Available)
		out.QueueRunning += int(r.Running)
		out.QueueRetryable += int(r.Retryable)
		out.DiscardedJobs += int(r.Discarded)
	}
	// 失败的 Operation 在业务表里，受 RLS 约束，跨用户数不出来。
	// 这里用被丢弃的任务近似——两者说的是同一件事：有活儿彻底失败了。
	out.FailedOperations = out.DiscardedJobs
	return out, nil
}

// AdminGetProviders 返回外部服务的健康状况。
//
// 数据来自 ai_actions 的审计记录——它按用户隔离，跨用户统计要走读模型。
// 目前读模型里只有按天的用量，没有按 Provider 的成功率，
// 因此这里只给出「配了哪些 Provider」与队列可见的失败情况。
func (a *ReadAPI) AdminGetProviders(ctx context.Context,
	_ adminapi.AdminGetProvidersRequestObject) (adminapi.AdminGetProvidersResponseObject, error) {

	// 直接读不带 user_id 的价格表，能知道系统里实际出现过哪些 Provider 与模型。
	var providers []string
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, "SELECT DISTINCT provider FROM ai_model_prices ORDER BY provider")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return err
			}
			providers = append(providers, name)
		}
		return rows.Err()
	})
	if err != nil {
		a.logger.Error("Provider 状态取数失败", "error", err)
		return adminapi.AdminGetProviders500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	items := make([]adminapi.ProviderStatus, 0, len(providers))
	for _, name := range providers {
		items = append(items, adminapi.ProviderStatus{
			Name: name, Kind: adminapi.ProviderStatusKindAi,
			// 成功率等指标要按 Provider 聚合 ai_actions，而那张表受 RLS 约束。
			// **返回空而不是 0**：0% 成功率会被当成「这个服务挂了」。
			Calls24h:        0,
			SuccessRate:     nil,
			ErrorRate:       nil,
			RateLimitedRate: nil,
		})
	}

	return adminapi.AdminGetProviders200JSONResponse(adminapi.ProviderStatusResponse{
		Data: items, Meta: meta(ctx),
	}), nil
}

// AdminListOperations 返回异步操作列表。
//
// async_operations 受 RLS 约束，跨用户读不出来。**没有 user_id 时直接拒绝**，
// 而不是绕过 RLS——后台看单个用户的 Operation 是支持的，看所有人的不支持，
// 这是有意的边界，不是暂未实现。
func (a *ReadAPI) AdminListOperations(ctx context.Context,
	req adminapi.AdminListOperationsRequestObject) (adminapi.AdminListOperationsResponseObject, error) {

	if req.Params.UserId == nil || *req.Params.UserId == "" {
		return adminapi.AdminListOperations400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(errorBody(ctx,
				adminapi.ADMINVALIDATIONFAILED,
				"请指定 user_id：Operation 属于具体用户，后台不提供跨用户查询。")),
		}, nil
	}

	body, err := a.operationsFor(ctx, *req.Params.UserId, req.Params.Cursor, req.Params.Limit)
	if err != nil {
		return adminapi.AdminListOperations500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}
	return adminapi.AdminListOperations200JSONResponse(body), nil
}

// AdminGetUserOperations 返回某个用户的 Operation。
func (a *ReadAPI) AdminGetUserOperations(ctx context.Context,
	req adminapi.AdminGetUserOperationsRequestObject) (adminapi.AdminGetUserOperationsResponseObject, error) {

	body, err := a.operationsFor(ctx, req.UserId, req.Params.Cursor, req.Params.Limit)
	if err != nil {
		return adminapi.AdminGetUserOperations500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}
	return adminapi.AdminGetUserOperations200JSONResponse(body), nil
}

// operationsFor 在某个用户的 RLS 事务里读他的 Operation。
func (a *ReadAPI) operationsFor(ctx context.Context, userID string,
	cursor *string, limit *int) (adminapi.AdminOperationListResponse, error) {

	cursorTime, cursorID := decodeCursor(cursor)
	size := limitOf(limit)

	type row struct {
		ID, Kind, Status string
		CreatedAt        time.Time
		// async_operations 没有 updated_at，只有 completed_at：
		// 一次操作要么还在跑，要么已经结束，中间没有「被更新」这个状态。
		CompletedAt *time.Time
		ResourceID  *string
		ErrorCode   *string
	}
	var rows []row

	err := a.db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// 只取标识、状态与错误码。**不取请求体与结果正文**——
		// 那里面是用户输入的东西。
		result, err := tx.Query(ctx, `
			SELECT id, kind, status, created_at, completed_at, result_ref,
			       error ->> 'code'
			  FROM async_operations
			 WHERE ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3))
			 ORDER BY created_at DESC, id DESC LIMIT $1`, size+1, cursorTime, cursorID)
		if err != nil {
			return err
		}
		defer result.Close()
		for result.Next() {
			var r row
			if err := result.Scan(&r.ID, &r.Kind, &r.Status, &r.CreatedAt,
				&r.CompletedAt, &r.ResourceID, &r.ErrorCode); err != nil {
				return err
			}
			rows = append(rows, r)
		}
		return result.Err()
	})
	if err != nil {
		a.logger.Error("Operation 取数失败", "user_id", userID, "error", err)
		return adminapi.AdminOperationListResponse{}, err
	}

	var nextCursor *string
	if len(rows) > int(size) {
		last := rows[size-1]
		token := encodeCursor(last.CreatedAt, last.ID)
		nextCursor = &token
		rows = rows[:size]
	}

	items := make([]adminapi.AdminOperation, 0, len(rows))
	for _, r := range rows {
		items = append(items, adminapi.AdminOperation{
			Id: r.ID, Kind: r.Kind, Status: r.Status,
			CreatedAt: r.CreatedAt, UpdatedAt: r.CompletedAt,
			ResourceId: r.ResourceID, ErrorCode: r.ErrorCode,
		})
	}

	return adminapi.AdminOperationListResponse{
		Data: items, Page: adminapi.PageInfo{NextCursor: nextCursor}, Meta: meta(ctx),
	}, nil
}
