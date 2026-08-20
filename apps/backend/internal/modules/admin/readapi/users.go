package readapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// AdminListUsers 返回用户列表。
//
// 读的是 admin.user_index 这张脱敏读模型，**不碰 users 表**：
// users 受 RLS 约束，没有身份读不出来，有身份又只能看一个人。
func (a *ReadAPI) AdminListUsers(ctx context.Context,
	req adminapi.AdminListUsersRequestObject) (adminapi.AdminListUsersResponseObject, error) {

	cursorTime, cursorID := decodeCursor(req.Params.Cursor)
	limit := limitOf(req.Params.Limit)

	params := dbgen.AdminListUsersParams{
		UserID: nilIfEmpty(req.Params.UserId),
		// 多取一条用来判断还有没有下一页，返回时再砍掉。
		// 不这么做就得额外跑一次 count，而 count 在大表上很贵。
		RowLimit:      limit + 1,
		CursorCreated: cursorTime,
		CursorID:      cursorID,
	}
	if req.Params.AccountStatus != nil {
		value := string(*req.Params.AccountStatus)
		params.AccountStatus = &value
	}
	params.Initialized = req.Params.Initialized
	// 手机号只支持精确匹配：库里没有明文，比对的是版本化 HMAC。
	// 模糊搜索等于提供一个把号码一位一位试出来的接口。
	if phone := nilIfEmpty(req.Params.Phone); phone != nil {
		params.PhoneHash = a.phoneHash(*phone)
	}

	var rows []dbgen.AdminListUsersRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		rows, err = q.AdminListUsers(ctx, params)
		return err
	})
	if err != nil {
		a.logger.Error("用户列表取数失败", "error", err)
		return adminapi.AdminListUsers500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	var nextCursor *string
	if len(rows) > int(limit) {
		last := rows[limit-1]
		token := encodeCursor(last.CreatedAt, last.UserID)
		nextCursor = &token
		rows = rows[:limit]
	}

	items := make([]adminapi.AdminUserSummary, 0, len(rows))
	for _, r := range rows {
		item := adminapi.AdminUserSummary{
			Id:            r.UserID,
			MaskedPhone:   r.MaskedPhone,
			AccountStatus: adminapi.AccountStatus(r.AccountStatus),
			Initialized:   r.Initialized,
			CreatedAt:     r.CreatedAt,
			LastActiveAt:  r.LastActiveAt,
			ActiveDays30d: int(r.ActiveDays30d),
			AiCost30d:     money(r.AiCost30d, r.AiCostStatus),
			// version 用于管理操作的乐观锁。读模型里没有它，
			// 由用户详情接口从 users 表实时取——列表页不需要精确值。
			Version: 0,
		}
		if r.DisplayName != "" {
			name := r.DisplayName
			item.DisplayName = &name
		}
		item.LatestErrorCode = r.LatestErrorCode
		items = append(items, item)
	}

	return adminapi.AdminListUsers200JSONResponse(adminapi.AdminUserListResponse{
		Data:      items,
		Page:      adminapi.PageInfo{NextCursor: nextCursor},
		Freshness: a.freshness(ctx),
		Meta:      meta(ctx),
	}), nil
}

// AdminGetUser 返回用户概览。
//
// **只返回状态、数量与标识。** 不返回笔记、会话消息、记忆、OCR 结果
// 或媒体正文——后台能知道「这个人有多少条笔记」，但看不到笔记写了什么。
func (a *ReadAPI) AdminGetUser(ctx context.Context,
	req adminapi.AdminGetUserRequestObject) (adminapi.AdminGetUserResponseObject, error) {

	var index dbgen.AdminGetUserIndexRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		index, err = q.AdminGetUserIndex(ctx, req.UserId)
		return err
	})
	if err != nil {
		if database.IsNoRows(err) {
			return adminapi.AdminGetUser404JSONResponse{
				NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
					errorBody(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。")),
			}, nil
		}
		a.logger.Error("用户概览取数失败", "error", err)
		return adminapi.AdminGetUser500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	// 数量要在该用户的 RLS 事务里数——这是后台唯一会碰业务表的地方，
	// 而且**一次事务只绑一个用户**。
	counts, sessions, version, err := a.userCounts(ctx, req.UserId)
	if err != nil {
		a.logger.Error("用户明细取数失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminGetUser500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	detail := adminapi.AdminUserDetail{
		Id:             index.UserID,
		MaskedPhone:    index.MaskedPhone,
		AccountStatus:  adminapi.AccountStatus(index.AccountStatus),
		Initialized:    index.Initialized,
		Timezone:       index.Timezone,
		CreatedAt:      index.CreatedAt,
		LastActiveAt:   index.LastActiveAt,
		ActiveSessions: &sessions,
		Counts:         counts,
		Version:        version,
	}
	if index.DisplayName != "" {
		name := index.DisplayName
		detail.DisplayName = &name
	}

	return adminapi.AdminGetUser200JSONResponse(adminapi.AdminUserDetailResponse{
		Data: detail, Meta: meta(ctx),
	}), nil
}

// userCounts 在该用户的 RLS 事务里数各类对象。
//
// **只数数量，不读正文。** SQL 里一个 SELECT 具体字段都没有。
func (a *ReadAPI) userCounts(ctx context.Context, userID string) (adminapi.UserCounts, int, int, error) {
	var c adminapi.UserCounts
	var sessions, version int

	err := a.db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			SELECT
			    (SELECT count(*) FROM tasks),
			    (SELECT count(*) FROM events),
			    (SELECT count(*) FROM projects),
			    (SELECT count(*) FROM notes),
			    (SELECT count(*) FROM captures),
			    (SELECT count(*) FROM assistant_threads),
			    (SELECT count(*) FROM auth_refresh_tokens
			      WHERE revoked_at IS NULL AND expires_at > now()),
			    -- status_version 由用户管理那一步（步骤四）加上。
			    -- 还没有时一律返回 0：管理操作会带着它做乐观锁，
			    -- 0 对 0 能过，加上列之后才真正起作用。
			    0`).
			Scan(&c.Tasks, &c.Events, &c.Projects, &c.Notes, &c.Captures,
				&c.AssistantThreads, &sessions, &version)
	})
	return c, sessions, version, err
}

// AdminGetUserUsage 返回用户的按天使用情况。
func (a *ReadAPI) AdminGetUserUsage(ctx context.Context,
	req adminapi.AdminGetUserUsageRequestObject) (adminapi.AdminGetUserUsageResponseObject, error) {

	from, to := a.resolveRange(req.Params.From, req.Params.To)

	var rows []dbgen.AdminUserDailyUsageRow
	err := a.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		rows, err = q.AdminUserDailyUsage(ctx, dbgen.AdminUserDailyUsageParams{
			UserID: req.UserId, FromDate: from, ToDate: to,
		})
		return err
	})
	if err != nil {
		a.logger.Error("用户使用情况取数失败", "error", err)
		return adminapi.AdminGetUserUsage500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				errorBody(ctx, adminapi.ADMININTERNALERROR, "取数失败。")),
		}, nil
	}

	points := make([]adminapi.UserUsagePoint, 0, len(rows))
	for _, r := range rows {
		points = append(points, adminapi.UserUsagePoint{
			Date:             dateOf(r.ReportDate),
			Active:           r.Active,
			CaptureSubmitted: int(r.CaptureSubmitted),
			CaptureConfirmed: int(r.CaptureConfirmed),
			TaskCompleted:    int(r.TaskCompleted),
			AssistantTurns:   int(r.AssistantTurns),
			ProposalExecuted: int(r.ProposalExecuted),
			ReviewGenerated:  int(r.ReviewGenerated),
		})
	}

	return adminapi.AdminGetUserUsage200JSONResponse(adminapi.UserUsageResponse{
		Data: points, Freshness: a.freshness(ctx), Meta: meta(ctx),
	}), nil
}

// phoneHash 算手机号的查询散列，必须和聚合时用的是同一套。
func (a *ReadAPI) phoneHash(phone string) []byte {
	if phone == "" || len(a.phoneKey) == 0 {
		return nil
	}
	mac := hmac.New(sha256.New, a.phoneKey)
	mac.Write([]byte(phone))
	return mac.Sum(nil)
}
