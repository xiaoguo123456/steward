package writeapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// WriteAPI 实现后台的写操作。
type WriteAPI struct {
	svc    *Service
	costs  *costs.Service
	logger *slog.Logger
}

// NewWriteAPI 构造写操作 API。
func NewWriteAPI(svc *Service, cost *costs.Service, logger *slog.Logger) *WriteAPI {
	if logger == nil {
		logger = slog.Default()
	}
	return &WriteAPI{svc: svc, costs: cost, logger: logger}
}

// AdminSuspendUser 暂停用户。
func (a *WriteAPI) AdminSuspendUser(ctx context.Context,
	req adminapi.AdminSuspendUserRequestObject) (adminapi.AdminSuspendUserResponseObject, error) {

	in, bad := a.inputOf(ctx, req.UserId, req.Params.IdempotencyKey, req.Body)
	if bad != nil {
		return adminapi.AdminSuspendUser400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(*bad)}, nil
	}

	result, err := a.svc.Suspend(ctx, in)
	if err != nil {
		return a.suspendError(ctx, err), nil
	}
	return adminapi.AdminSuspendUser200JSONResponse(adminapi.SuspendResultResponse{
		Data: statusDTO(result), Meta: meta(ctx),
	}), nil
}

// AdminResumeUser 恢复用户。
func (a *WriteAPI) AdminResumeUser(ctx context.Context,
	req adminapi.AdminResumeUserRequestObject) (adminapi.AdminResumeUserResponseObject, error) {

	in, bad := a.inputOf(ctx, req.UserId, req.Params.IdempotencyKey, req.Body)
	if bad != nil {
		return adminapi.AdminResumeUser400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(*bad)}, nil
	}

	result, err := a.svc.Resume(ctx, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			return adminapi.AdminResumeUser404JSONResponse{
				NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
					body(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。"))}, nil
		case errors.Is(err, ErrVersionStale):
			return adminapi.AdminResumeUser409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINVERSIONCONFLICT, "数据已被改动，请刷新后重试。"))}, nil
		case errors.Is(err, ErrStatusInvalid):
			return adminapi.AdminResumeUser409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINUSERSTATUSCONFLICT, "该用户当前不是暂停状态。"))}, nil
		case errors.Is(err, ErrKeyReused):
			return adminapi.AdminResumeUser409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINIDEMPOTENCYKEYREUSED,
						"这个幂等键已经用于另一个请求。"))}, nil
		}
		a.logger.Error("恢复用户失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminResumeUser500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				body(ctx, adminapi.ADMININTERNALERROR, "操作失败。"))}, nil
	}
	return adminapi.AdminResumeUser200JSONResponse(adminapi.SuspendResultResponse{
		Data: statusDTO(result), Meta: meta(ctx),
	}), nil
}

// AdminRevokeUserSessions 撤销用户会话。
func (a *WriteAPI) AdminRevokeUserSessions(ctx context.Context,
	req adminapi.AdminRevokeUserSessionsRequestObject) (adminapi.AdminRevokeUserSessionsResponseObject, error) {

	in, bad := a.inputOf(ctx, req.UserId, req.Params.IdempotencyKey, req.Body)
	if bad != nil {
		return adminapi.AdminRevokeUserSessions400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(*bad)}, nil
	}

	result, err := a.svc.RevokeSessions(ctx, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			return adminapi.AdminRevokeUserSessions404JSONResponse{
				NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
					body(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。"))}, nil
		case errors.Is(err, ErrVersionStale):
			return adminapi.AdminRevokeUserSessions409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINVERSIONCONFLICT, "数据已被改动，请刷新后重试。"))}, nil
		case errors.Is(err, ErrKeyReused):
			return adminapi.AdminRevokeUserSessions409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINIDEMPOTENCYKEYREUSED,
						"这个幂等键已经用于另一个请求。"))}, nil
		}
		a.logger.Error("撤销会话失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminRevokeUserSessions500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				body(ctx, adminapi.ADMININTERNALERROR, "操作失败。"))}, nil
	}

	return adminapi.AdminRevokeUserSessions200JSONResponse(adminapi.RevokeSessionsResultResponse{
		Data: adminapi.RevokeSessionsResult{
			UserId: result.UserID, RevokedSessions: int(result.RevokedSessions),
			EffectiveAt: time.Now(), AuditLogId: result.AuditLogID,
		},
		Meta: meta(ctx),
	}), nil
}

// AdminSetUserBudget 设置用户 AI 预算。
func (a *WriteAPI) AdminSetUserBudget(ctx context.Context,
	req adminapi.AdminSetUserBudgetRequestObject) (adminapi.AdminSetUserBudgetResponseObject, error) {

	if req.Body == nil {
		return adminapi.AdminSetUserBudget400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(
				body(ctx, adminapi.ADMINVALIDATIONFAILED, "缺少请求体。"))}, nil
	}
	if err := validateReason(string(req.Body.ReasonCode), req.Body.ReasonText); err != nil {
		return adminapi.AdminSetUserBudget400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(
				body(ctx, adminapi.ADMINREASONREQUIRED, err.Error()))}, nil
	}

	raw, _ := json.Marshal(req.Body)
	in := BudgetInput{
		ActionInput: ActionInput{
			UserID: req.UserId, ExpectedVersion: int32(req.Body.ExpectedVersion),
			ReasonCode: string(req.Body.ReasonCode), ReasonText: req.Body.ReasonText,
			IdempotencyKey: req.Params.IdempotencyKey, RequestBody: raw,
			RequestID: httpx.RequestID(ctx),
		},
		EffectiveFrom: req.Body.EffectiveFrom, EffectiveUntil: req.Body.EffectiveUntil,
	}
	if req.Body.DailyCalls != nil {
		value := int32(*req.Body.DailyCalls)
		in.DailyCalls = &value
	}
	if req.Body.MonthlyCalls != nil {
		value := int32(*req.Body.MonthlyCalls)
		in.MonthlyCalls = &value
	}

	result, err := a.svc.SetBudget(ctx, in)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return adminapi.AdminSetUserBudget404JSONResponse{
				NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
					body(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。"))}, nil
		}
		if errors.Is(err, ErrKeyReused) {
			return adminapi.AdminSetUserBudget409JSONResponse{
				ConflictJSONResponse: adminapi.ConflictJSONResponse(
					body(ctx, adminapi.ADMINIDEMPOTENCYKEYREUSED,
						"这个幂等键已经用于另一个请求。"))}, nil
		}
		a.logger.Error("设置预算失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminSetUserBudget500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				body(ctx, adminapi.ADMININTERNALERROR, "操作失败。"))}, nil
	}

	return adminapi.AdminSetUserBudget200JSONResponse(adminapi.BudgetResultResponse{
		Data: budgetDTO(result), Meta: meta(ctx),
	}), nil
}

// AdminClearUserBudget 清除用户 AI 预算。
func (a *WriteAPI) AdminClearUserBudget(ctx context.Context,
	req adminapi.AdminClearUserBudgetRequestObject) (adminapi.AdminClearUserBudgetResponseObject, error) {

	result, err := a.svc.SetBudget(ctx, BudgetInput{
		ActionInput: ActionInput{
			UserID: req.UserId,
			// 清除不需要乐观锁：它是幂等的终态操作，清了再清还是清了。
			ReasonCode: "other", ReasonText: "管理员清除预算限制",
			IdempotencyKey: req.Params.IdempotencyKey,
			RequestBody:    []byte("clear"), RequestID: httpx.RequestID(ctx),
		},
		Clear: true,
	})
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return adminapi.AdminClearUserBudget404JSONResponse{
				NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
					body(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。"))}, nil
		}
		a.logger.Error("清除预算失败", "user_id", req.UserId, "error", err)
		return adminapi.AdminClearUserBudget500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				body(ctx, adminapi.ADMININTERNALERROR, "操作失败。"))}, nil
	}
	return adminapi.AdminClearUserBudget200JSONResponse(adminapi.BudgetResultResponse{
		Data: budgetDTO(result), Meta: meta(ctx),
	}), nil
}

// inputOf 校验公共入参。
func (a *WriteAPI) inputOf(ctx context.Context, userID, key string,
	req *adminapi.AdminActionRequest) (ActionInput, *adminapi.ErrorResponse) {

	if req == nil {
		bad := body(ctx, adminapi.ADMINVALIDATIONFAILED, "缺少请求体。")
		return ActionInput{}, &bad
	}
	if err := validateReason(string(req.ReasonCode), req.ReasonText); err != nil {
		bad := body(ctx, adminapi.ADMINREASONREQUIRED, err.Error())
		return ActionInput{}, &bad
	}

	raw, _ := json.Marshal(req)
	return ActionInput{
		UserID: userID, ExpectedVersion: int32(req.ExpectedVersion),
		ReasonCode: string(req.ReasonCode), ReasonText: req.ReasonText,
		ExpiresAt: req.ExpiresAt, IdempotencyKey: key,
		RequestBody: raw, RequestID: httpx.RequestID(ctx),
	}, nil
}

func (a *WriteAPI) suspendError(ctx context.Context, err error) adminapi.AdminSuspendUserResponseObject {
	switch {
	case errors.Is(err, ErrUserNotFound):
		return adminapi.AdminSuspendUser404JSONResponse{
			NotFoundJSONResponse: adminapi.NotFoundJSONResponse(
				body(ctx, adminapi.ADMINUSERNOTFOUND, "用户不存在。"))}
	case errors.Is(err, ErrVersionStale):
		return adminapi.AdminSuspendUser409JSONResponse{
			ConflictJSONResponse: adminapi.ConflictJSONResponse(
				body(ctx, adminapi.ADMINVERSIONCONFLICT, "数据已被改动，请刷新后重试。"))}
	case errors.Is(err, ErrStatusInvalid):
		return adminapi.AdminSuspendUser409JSONResponse{
			ConflictJSONResponse: adminapi.ConflictJSONResponse(
				body(ctx, adminapi.ADMINUSERSTATUSCONFLICT, "该用户已经是暂停状态。"))}
	case errors.Is(err, ErrKeyReused):
		return adminapi.AdminSuspendUser409JSONResponse{
			ConflictJSONResponse: adminapi.ConflictJSONResponse(
				body(ctx, adminapi.ADMINIDEMPOTENCYKEYREUSED, "这个幂等键已经用于另一个请求。"))}
	}
	a.logger.Error("暂停用户失败", "error", err)
	return adminapi.AdminSuspendUser500JSONResponse{
		InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
			body(ctx, adminapi.ADMININTERNALERROR, "操作失败。"))}
}

// validateReason 校验处置理由。
//
// 理由是必填的：**没有理由的处置等于没有记录**，
// 事后没人能判断那次操作是否恰当。
func validateReason(code, text string) error {
	if code == "" {
		return errors.New("请选择处置原因。")
	}
	if len([]rune(text)) < 4 {
		return errors.New("请写清楚具体原因，至少四个字。")
	}
	return nil
}

func statusDTO(r StatusResult) adminapi.SuspendResult {
	return adminapi.SuspendResult{
		UserId:              r.UserID,
		AccountStatus:       adminapi.AccountStatus(r.AccountStatus),
		Version:             int(r.Version),
		RevokedSessions:     int(r.RevokedSessions),
		SuspendedAt:         r.SuspendedAt,
		SuspensionExpiresAt: r.SuspensionExpiresAt,
		AuditLogId:          r.AuditLogID,
	}
}

func budgetDTO(r BudgetResult) adminapi.BudgetResult {
	out := adminapi.BudgetResult{UserId: r.UserID, AuditLogId: r.AuditLogID}
	if r.Budget != nil {
		budget := adminapi.AIBudget{
			EffectiveFrom:  &r.Budget.EffectiveFrom,
			EffectiveUntil: r.Budget.EffectiveUntil,
		}
		if r.Budget.DailyCalls != nil {
			value := int(*r.Budget.DailyCalls)
			budget.DailyCalls = &value
		}
		if r.Budget.MonthlyCalls != nil {
			value := int(*r.Budget.MonthlyCalls)
			budget.MonthlyCalls = &value
		}
		out.Budget = &budget
	}
	return out
}

func meta(ctx context.Context) adminapi.ResponseMeta {
	return adminapi.ResponseMeta{RequestId: httpx.RequestID(ctx)}
}

func body(ctx context.Context, code adminapi.ErrorCode, message string) adminapi.ErrorResponse {
	return adminapi.ErrorResponse{
		Error: adminapi.Error{Code: code, Message: message}, Meta: meta(ctx),
	}
}

var _ = dbgen.UserAiBudget{}

// AdminListAIPrices 返回价格列表。
func (a *WriteAPI) AdminListAIPrices(ctx context.Context,
	_ adminapi.AdminListAIPricesRequestObject) (adminapi.AdminListAIPricesResponseObject, error) {

	rows, err := a.costs.ListPrices(ctx)
	if err != nil {
		a.logger.Error("价格列表取数失败", "error", err)
		return adminapi.AdminListAIPrices500JSONResponse{
			InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(
				body(ctx, adminapi.ADMININTERNALERROR, "取数失败。"))}, nil
	}

	items := make([]adminapi.AIPrice, 0, len(rows))
	for _, r := range rows {
		items = append(items, adminapi.AIPrice{
			Id: r.ID, Provider: r.Provider, Model: r.Model,
			UsageUnit:      adminapi.UsageUnit(r.UsageUnit),
			UnitSize:       r.UnitSize,
			UnitPriceUsd:   r.UnitPriceUsd,
			EffectiveFrom:  r.EffectiveFrom,
			EffectiveUntil: r.EffectiveUntil,
		})
	}
	return adminapi.AdminListAIPrices200JSONResponse(adminapi.AIPriceListResponse{
		Data: items, Meta: meta(ctx),
	}), nil
}

// AdminCreateAIPrice 新增一个价格版本。
func (a *WriteAPI) AdminCreateAIPrice(ctx context.Context,
	req adminapi.AdminCreateAIPriceRequestObject) (adminapi.AdminCreateAIPriceResponseObject, error) {

	if req.Body == nil {
		return adminapi.AdminCreateAIPrice400JSONResponse{
			BadRequestJSONResponse: adminapi.BadRequestJSONResponse(
				body(ctx, adminapi.ADMINVALIDATIONFAILED, "缺少请求体。"))}, nil
	}

	row, err := a.costs.AddPrice(ctx, costs.PriceInput{
		Provider: req.Body.Provider, Model: req.Body.Model,
		UsageUnit:      string(req.Body.UsageUnit),
		UnitSize:       req.Body.UnitSize,
		UnitPriceUSD:   req.Body.UnitPriceUsd,
		EffectiveFrom:  req.Body.EffectiveFrom,
		EffectiveUntil: req.Body.EffectiveUntil,
	})
	if err != nil {
		// 生效区间重叠由数据库的排他约束拦下。**这是冲突不是内部错误**：
		// 调用方改一下时间区间就能成功，报 500 会让人以为是服务坏了。
		a.logger.Warn("新增价格被拒", "error", err)
		return adminapi.AdminCreateAIPrice409JSONResponse{
			ConflictJSONResponse: adminapi.ConflictJSONResponse(body(ctx,
				adminapi.ADMINVALIDATIONFAILED,
				"这个服务商、模型与用量单位在该时间段内已经有价格了。"))}, nil
	}

	return adminapi.AdminCreateAIPrice200JSONResponse(adminapi.AIPriceResponse{
		Data: adminapi.AIPrice{
			Id: row.ID, Provider: row.Provider, Model: row.Model,
			UsageUnit:      adminapi.UsageUnit(row.UsageUnit),
			UnitSize:       costs.NumericString(row.UnitSize),
			UnitPriceUsd:   costs.NumericString(row.UnitPriceUsd),
			EffectiveFrom:  row.EffectiveFrom,
			EffectiveUntil: row.EffectiveUntil,
		},
		Meta: meta(ctx),
	}), nil
}
