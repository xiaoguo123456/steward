// Package writeapi 实现后台的用户管理操作。
//
// 每一个操作都在**单个事务**里完成：读当前状态 → 校验版本 → 改 → 写审计。
// 审计写不进去，业务变更也回滚。
//
// 这条不是形式主义。一条能被绕过的审计，比没有审计更危险：
// 它会让人以为所有操作都有记录，从而在事后不再去别处查证。
package writeapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 几种业务上的失败。它们各自对应一个稳定的错误码，界面据此给不同提示。
var (
	ErrUserNotFound  = errors.New("用户不存在")
	ErrVersionStale  = errors.New("版本冲突")
	ErrStatusInvalid = errors.New("状态不允许这样转换")
	ErrKeyReused     = errors.New("幂等键被复用于不同的请求")
)

// Service 执行管理操作。
type Service struct {
	db     *database.DB
	logger *slog.Logger
}

// New 构造服务。
func New(db *database.DB, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{db: db, logger: logger}
}

// ActionInput 是管理操作的公共入参。
type ActionInput struct {
	UserID          string
	ExpectedVersion int32
	ReasonCode      string
	ReasonText      string
	ExpiresAt       *time.Time

	// IdempotencyKey 与 RequestBody 用于幂等判断。
	IdempotencyKey string
	RequestBody    []byte
	RequestID      string

	// 操作者。审计要回答「谁做的」，由 Handler 从已验证的会话里取，
	// **不接受调用方自报**——自报的身份在审计里等于没有身份。
	ActorUsername  string
	ActorSessionID string
}

// StatusResult 是暂停/恢复的结果。
type StatusResult struct {
	UserID              string
	AccountStatus       string
	Version             int32
	RevokedSessions     int64
	SuspendedAt         *time.Time
	SuspensionExpiresAt *time.Time
	AuditLogID          string
	// Replayed 为 true 表示这次是幂等重放，没有真的改动任何东西。
	Replayed bool
}

// Suspend 暂停用户。
//
// 只允许 active → suspended，并**同时撤销全部登录会话**：
// 暂停但不踢下线等于没暂停，他手里的令牌还能用到过期。
func (s *Service) Suspend(ctx context.Context, in ActionInput) (StatusResult, error) {
	return s.changeStatus(ctx, in, "suspend", "active", "suspended")
}

// Resume 恢复用户。
//
// 只允许 suspended → active。**不恢复旧会话**——那些是暂停时主动撤销的，
// 恢复账号不等于恢复那批令牌；用户重新登录即可。
func (s *Service) Resume(ctx context.Context, in ActionInput) (StatusResult, error) {
	return s.changeStatus(ctx, in, "resume", "suspended", "active")
}

func (s *Service) changeStatus(ctx context.Context, in ActionInput,
	action, fromStatus, toStatus string) (StatusResult, error) {

	var out StatusResult
	err := s.db.InTx(ctx, in.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		// 幂等：同键同请求直接回放上次结果，同键不同请求报冲突。
		replayed, err := s.checkIdempotency(ctx, q, in, action, &out)
		if err != nil {
			return err
		}
		if replayed {
			out.Replayed = true
			return nil
		}

		// **加行锁再读。** 两个运营同时点「暂停」，不加锁的话两条都会成功、
		// 版本各加一次，而实际只该有一次状态转换。
		current, err := q.AdminLockUserForUpdate(ctx, in.UserID)
		if err != nil {
			if database.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}
		if current.StatusVersion != in.ExpectedVersion {
			return ErrVersionStale
		}
		if current.AccountStatus != fromStatus {
			return ErrStatusInvalid
		}

		params := dbgen.AdminSetUserStatusParams{
			ID: in.UserID, AccountStatus: toStatus,
			ExpectedVersion: in.ExpectedVersion,
		}
		if toStatus == "suspended" {
			now := time.Now()
			params.SuspendedAt = &now
			params.SuspensionExpiresAt = in.ExpiresAt
		}
		updated, err := q.AdminSetUserStatus(ctx, params)
		if err != nil {
			if database.IsNoRows(err) {
				// UPDATE 没命中：版本在加锁之后又被人改了。
				return ErrVersionStale
			}
			return err
		}

		out.UserID = updated.ID
		out.AccountStatus = updated.AccountStatus
		out.Version = updated.StatusVersion
		out.SuspendedAt = updated.SuspendedAt
		out.SuspensionExpiresAt = updated.SuspensionExpiresAt

		if action == "suspend" {
			revoked, err := q.AdminRevokeUserSessions(ctx)
			if err != nil {
				return err
			}
			out.RevokedSessions = revoked
		}

		// 审计和业务变更在**同一个事务**里。写不进去就一起回滚。
		auditID, err := s.writeAudit(ctx, q, in, action, "succeeded",
			map[string]any{"account_status": fromStatus, "version": in.ExpectedVersion},
			map[string]any{"account_status": toStatus, "version": out.Version,
				"revoked_sessions": out.RevokedSessions})
		if err != nil {
			return err
		}
		out.AuditLogID = auditID

		if _, err := q.AdminRecordAccountAction(ctx, dbgen.AdminRecordAccountActionParams{
			ID: idgen.New(idgen.PrefixAccountAction), UserID: in.UserID,
			Action: action, ReasonCode: in.ReasonCode, ReasonText: in.ReasonText,
			EffectiveUntil: in.ExpiresAt, AuditLogID: auditID,
		}); err != nil {
			return err
		}

		return s.saveIdempotency(ctx, q, in, action, out)
	})
	return out, err
}

// RevokeSessions 撤销用户全部会话，不改账号状态。
func (s *Service) RevokeSessions(ctx context.Context, in ActionInput) (StatusResult, error) {
	var out StatusResult
	err := s.db.InTx(ctx, in.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		replayed, err := s.checkIdempotency(ctx, q, in, "sessions_revoke", &out)
		if err != nil {
			return err
		}
		if replayed {
			out.Replayed = true
			return nil
		}

		current, err := q.AdminLockUserForUpdate(ctx, in.UserID)
		if err != nil {
			if database.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}
		if current.StatusVersion != in.ExpectedVersion {
			return ErrVersionStale
		}

		revoked, err := q.AdminRevokeUserSessions(ctx)
		if err != nil {
			return err
		}
		out.UserID = in.UserID
		out.AccountStatus = current.AccountStatus
		out.Version = current.StatusVersion
		out.RevokedSessions = revoked

		auditID, err := s.writeAudit(ctx, q, in, "sessions_revoke", "succeeded",
			nil, map[string]any{"revoked_sessions": revoked})
		if err != nil {
			return err
		}
		out.AuditLogID = auditID

		if _, err := q.AdminRecordAccountAction(ctx, dbgen.AdminRecordAccountActionParams{
			ID: idgen.New(idgen.PrefixAccountAction), UserID: in.UserID,
			Action: "sessions_revoke", ReasonCode: in.ReasonCode,
			ReasonText: in.ReasonText, AuditLogID: auditID,
		}); err != nil {
			return err
		}
		return s.saveIdempotency(ctx, q, in, "sessions_revoke", out)
	})
	return out, err
}

// BudgetInput 是设置预算的入参。
type BudgetInput struct {
	ActionInput
	DailyCalls     *int32
	MonthlyCalls   *int32
	EffectiveFrom  *time.Time
	EffectiveUntil *time.Time
	// Clear 为 true 表示清除预算。
	Clear bool
}

// BudgetResult 是设置预算的结果。
type BudgetResult struct {
	UserID     string
	Budget     *dbgen.UserAiBudget
	AuditLogID string
	Replayed   bool
}

// SetBudget 设置或清除用户的 AI 预算。
//
// **不会因为设了预算就替用户打开 AI。** 用户自己关掉的开关，
// 管理员不代他打开——那是他的选择，不是一个可以被运营顺手改掉的配置。
func (s *Service) SetBudget(ctx context.Context, in BudgetInput) (BudgetResult, error) {
	var out BudgetResult
	action := "budget_update"

	err := s.db.InTx(ctx, in.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		var status StatusResult
		replayed, err := s.checkIdempotency(ctx, q, in.ActionInput, action, &status)
		if err != nil {
			return err
		}
		if replayed {
			out.Replayed = true
			out.UserID = in.UserID
			out.AuditLogID = status.AuditLogID
			return nil
		}

		if _, err := q.AdminLockUserForUpdate(ctx, in.UserID); err != nil {
			if database.IsNoRows(err) {
				return ErrUserNotFound
			}
			return err
		}

		before, _ := q.AdminGetBudget(ctx, in.UserID)

		if in.Clear {
			if err := q.AdminClearBudget(ctx, in.UserID); err != nil {
				return err
			}
			out.Budget = nil
		} else {
			row, err := q.AdminUpsertBudget(ctx, dbgen.AdminUpsertBudgetParams{
				UserID: in.UserID, DailyCalls: in.DailyCalls,
				MonthlyCalls:   in.MonthlyCalls,
				EffectiveFrom:  in.EffectiveFrom,
				EffectiveUntil: in.EffectiveUntil,
			})
			if err != nil {
				return err
			}
			out.Budget = &row
		}
		out.UserID = in.UserID

		auditID, err := s.writeAudit(ctx, q, in.ActionInput, action, "succeeded",
			budgetSummary(&before), budgetSummary(out.Budget))
		if err != nil {
			return err
		}
		out.AuditLogID = auditID

		if _, err := q.AdminRecordAccountAction(ctx, dbgen.AdminRecordAccountActionParams{
			ID: idgen.New(idgen.PrefixAccountAction), UserID: in.UserID,
			Action: action, ReasonCode: in.ReasonCode, ReasonText: in.ReasonText,
			EffectiveUntil: in.EffectiveUntil, AuditLogID: auditID,
		}); err != nil {
			return err
		}
		return s.saveIdempotency(ctx, q, in.ActionInput, action,
			StatusResult{UserID: in.UserID, AuditLogID: auditID})
	})
	return out, err
}

// budgetSummary 把预算压成审计摘要。
//
// **只放数字，不放别的。** 摘要会被长期保存并可能被导出，
// 里面不该出现任何超出「改了什么」的信息。
func budgetSummary(b *dbgen.UserAiBudget) map[string]any {
	if b == nil || b.UserID == "" {
		return map[string]any{"budget": nil}
	}
	return map[string]any{
		"daily_calls": b.DailyCalls, "monthly_calls": b.MonthlyCalls,
	}
}

// writeAudit 在当前事务里写一条审计。
func (s *Service) writeAudit(ctx context.Context, q *dbgen.Queries, in ActionInput,
	action, outcome string, before, after map[string]any) (string, error) {

	id := idgen.New(idgen.PrefixAdminAudit)
	targetType := "user"
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)

	_, err := q.RecordAdminAudit(ctx, dbgen.RecordAdminAuditParams{
		ID: id, OccurredAt: time.Now(),
		ActorUsername: in.ActorUsername, ActorSessionID: nullable(in.ActorSessionID),
		Action: action, Outcome: outcome,
		TargetType: &targetType, TargetID: &in.UserID,
		ReasonCode: &in.ReasonCode, ReasonText: &in.ReasonText,
		RequestID:     in.RequestID,
		BeforeSummary: beforeJSON, AfterSummary: afterJSON,
	})
	if err != nil {
		return "", err
	}
	return id, nil
}

// checkIdempotency 判断这次请求是不是重放。
//
// 返回 true 表示是重放，已经把上次的结果填进 out。
// 同一个键配不同的请求体返回 ErrKeyReused——那说明调用方把键用错了，
// 把上一次的结果发回去会让他以为新请求成功了。
func (s *Service) checkIdempotency(ctx context.Context, q *dbgen.Queries,
	in ActionInput, action string, out *StatusResult) (bool, error) {

	if in.IdempotencyKey == "" {
		return false, nil
	}
	row, err := q.AdminFindIdempotency(ctx, dbgen.AdminFindIdempotencyParams{
		UserID: in.UserID, Endpoint: action, Key: in.IdempotencyKey,
	})
	if err != nil {
		if database.IsNoRows(err) {
			return false, nil
		}
		return false, err
	}
	if !bytes.Equal(row.RequestHash, requestHash(in.RequestBody)) {
		return false, ErrKeyReused
	}
	if len(row.ResponseBody) > 0 {
		_ = json.Unmarshal(row.ResponseBody, out)
	}
	return true, nil
}

func (s *Service) saveIdempotency(ctx context.Context, q *dbgen.Queries,
	in ActionInput, action string, result StatusResult) error {

	if in.IdempotencyKey == "" {
		return nil
	}
	body, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return q.AdminSaveIdempotency(ctx, dbgen.AdminSaveIdempotencyParams{
		UserID: in.UserID, Endpoint: action, Key: in.IdempotencyKey,
		RequestHash: requestHash(in.RequestBody),
		StatusCode:  200, ResponseBody: body,
	})
}

// requestHash 算请求体的指纹，用于分辨「同键同请求」与「同键不同请求」。
func requestHash(body []byte) []byte {
	sum := sha256.Sum256(body)
	return sum[:]
}

// nullable 把空字符串转成 NULL。审计里「没有」和「空」不是一回事。
func nullable(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}
