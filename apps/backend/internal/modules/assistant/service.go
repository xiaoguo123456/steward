// Package assistant 拥有通用对话域：Thread、Message、Turn、Tool Call 与 Action Proposal。
//
// 三条硬规则贯穿整个模块：
//  1. 模型只产建议，任何写入都必须由用户确认后经 Domain Command 执行。
//  2. 模型不知道任何业务事实，只有调用过的工具结果才是它的依据。
//  3. 权威会话是本模块的表，Provider 侧状态只是可以随时丢弃的优化。
package assistant

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/assets"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// UserProfile 是 users 模块公开的能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
	AiSettingsInTx(ctx context.Context, q *dbgen.Queries, userID string) (dbgen.UserAiSetting, error)
}

// JobEnqueuer 在业务事务内登记异步任务。
//
// 必须与 Turn 写入使用同一事务：否则会出现消息已保存但回复任务丢失，
// 用户永远看不到回复。
type JobEnqueuer interface {
	EnqueueAssistantRespond(ctx context.Context, q *dbgen.Queries, args RespondArgs) error
}

// RespondArgs 是 assistant.respond 的任务参数。
// 它只携带引用与幂等键，不包含消息正文、记忆、工具结果或 Prompt。
type RespondArgs struct {
	SchemaVersion  int    `json:"schema_version"`
	UserID         string `json:"user_id"`
	ThreadID       string `json:"thread_id"`
	TurnID         string `json:"resource_id"`
	OperationID    string `json:"operation_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// Service 是 Assistant 的应用服务。
type Service struct {
	db     *database.DB
	engine ai.OrchestrationEngine
	// registry 保存全部已登记能力。每轮允许集合从它派生。
	registry *ai.Registry
	users    UserProfile
	jobs     JobEnqueuer
	proposal *ProposalService
	// memory 为空时本轮不带长期记忆，对话照常进行。
	memory MemorySearcher
	logger *slog.Logger
}

// New 构造 Service。
func New(db *database.DB, engine ai.OrchestrationEngine, registry *ai.Registry,
	users UserProfile, jobs JobEnqueuer, proposal *ProposalService,
	memory MemorySearcher, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		db: db, engine: engine, registry: registry,
		users: users, jobs: jobs, proposal: proposal,
		memory: memory, logger: logger,
	}
}

// ---- Thread ----

// CreateThread 新建对话。
func (s *Service) CreateThread(ctx context.Context, userID string, title *string) (dbgen.AssistantThread, error) {
	name := "新对话"
	if title != nil && strings.TrimSpace(*title) != "" {
		name = strings.TrimSpace(*title)
	}
	var out dbgen.AssistantThread
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		thread, err := q.CreateThread(ctx, dbgen.CreateThreadParams{
			ID: idgen.New(idgen.PrefixThread), UserID: userID, Title: name,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = thread
		return nil
	})
	return out, err
}

// ListThreads 读取对话列表。
func (s *Service) ListThreads(ctx context.Context, userID string, includeArchived bool,
	cursorTime *time.Time, cursorID *string, limit int32) ([]dbgen.AssistantThread, error) {

	var out []dbgen.AssistantThread
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListThreads(ctx, dbgen.ListThreadsParams{
			IncludeArchived: includeArchived,
			CursorUpdatedAt: cursorTime,
			CursorID:        cursorID,
			RowLimit:        limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// GetThread 读取单个对话。
func (s *Service) GetThread(ctx context.Context, userID, threadID string) (dbgen.AssistantThread, error) {
	var out dbgen.AssistantThread
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个对话")
			}
			return apperr.Internal(err)
		}
		out = thread
		return nil
	})
	return out, err
}

// UpdateThread 修改标题或归档状态。
//
// 归档只影响默认列表展示，不会让待确认建议自动执行。
func (s *Service) UpdateThread(ctx context.Context, userID, threadID string,
	title *string, status *string, expectedVersion *int32) (dbgen.AssistantThread, error) {

	var out dbgen.AssistantThread
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetThread(ctx, threadID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个对话")
			}
			return apperr.Internal(err)
		}
		if expectedVersion != nil && current.Version != *expectedVersion {
			return apperr.New(apperr.CodeVersionConflict)
		}
		thread, err := q.UpdateThread(ctx, dbgen.UpdateThreadParams{
			Title: title, Status: status, ID: threadID,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = thread
		return nil
	})
	return out, err
}

// DeleteThread 删除对话内容。
//
// 已经执行过的业务实体与 Activity 不随对话删除：它们是用户的正式内容，
// 与产生它们的对话无关。
func (s *Service) DeleteThread(ctx context.Context, userID, threadID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.SoftDeleteThread(ctx, threadID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个对话")
			}
			return apperr.Internal(err)
		}
		if err := q.SoftDeleteMessagesByThread(ctx, threadID); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// ListMessages 读取对话消息。
func (s *Service) ListMessages(ctx context.Context, userID, threadID string,
	cursorSeq *int32, limit int32) ([]dbgen.AssistantMessage, map[string][]string, error) {

	var (
		rows      []dbgen.AssistantMessage
		proposals = map[string][]string{}
	)
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetThread(ctx, threadID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个对话")
			}
			return apperr.Internal(err)
		}
		list, err := q.ListMessages(ctx, dbgen.ListMessagesParams{
			ThreadID: threadID, CursorSeq: cursorSeq, RowLimit: limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		rows = list

		// 建议按 Turn 归属，展示时挂到该 Turn 的 Assistant 消息上。
		for _, m := range list {
			if m.TurnID == nil || m.Role != "assistant" {
				continue
			}
			items, err := q.ListProposalsForTurn(ctx, m.TurnID)
			if err != nil {
				return apperr.Internal(err)
			}
			for _, p := range items {
				proposals[m.ID] = append(proposals[m.ID], p.ID)
			}
		}
		return nil
	})
	return rows, proposals, err
}

// ---- Turn ----

// TurnAccepted 是提交 Turn 的结果。
type TurnAccepted struct {
	ThreadID    string
	MessageID   string
	TurnID      string
	OperationID string
}

// CreateTurn 保存用户消息并登记回复任务。
//
// 全部在一个短事务内完成：分配序号、写消息、写 Turn、写 Operation、入队。
func (s *Service) CreateTurn(ctx context.Context, userID, threadID string,
	body httpapi.CreateTurnRequest) (TurnAccepted, error) {

	text := strings.TrimSpace(body.Text)
	if text == "" {
		return TurnAccepted{}, apperr.Validation(apperr.Field("text", "消息内容不能为空。"))
	}
	if len([]rune(text)) > 4000 {
		return TurnAccepted{}, apperr.Validation(apperr.Field("text", "单条消息过长，请分几次说。"))
	}

	var out TurnAccepted
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		thread, err := q.GetThread(ctx, threadID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个对话")
			}
			return apperr.Internal(err)
		}

		// 在同一事务内原子推进序号，避免并发提交产生重复 seq。
		seq, err := q.AdvanceThreadSeq(ctx, dbgen.AdvanceThreadSeqParams{
			MessageDelta: 1, TurnDelta: 1, ID: thread.ID,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		now := time.Now()
		message, err := q.CreateMessage(ctx, dbgen.CreateMessageParams{
			ID:          idgen.New(idgen.PrefixMessage),
			UserID:      userID,
			ThreadID:    thread.ID,
			MessageSeq:  seq.LastMessageSeq,
			Role:        "user",
			Content:     text,
			Status:      "completed",
			CompletedAt: &now,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		op, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID: idgen.New(idgen.PrefixOperation), UserID: userID, Kind: "assistant.respond",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		turn, err := q.CreateTurn(ctx, dbgen.CreateTurnParams{
			ID:            idgen.New(idgen.PrefixTurn),
			UserID:        userID,
			ThreadID:      thread.ID,
			TurnSeq:       seq.LastTurnSeq,
			UserMessageID: &message.ID,
			OperationID:   &op.ID,
			EngineType:    "direct",
			ModelPolicy:   "assistant.chat",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		// 同一 Thread 只让最新一轮继续跑：更早的排队轮次直接作废，
		// 避免用户改口后旧回复覆盖上下文顺序。
		if err := q.SupersedeOlderTurns(ctx, dbgen.SupersedeOlderTurnsParams{
			ThreadID: thread.ID, TurnSeq: turn.TurnSeq,
		}); err != nil {
			return apperr.Internal(err)
		}

		if err := s.saveEntryContext(ctx, q, turn.ID, body.EntryContext); err != nil {
			return err
		}

		if err := s.jobs.EnqueueAssistantRespond(ctx, q, RespondArgs{
			SchemaVersion:  1,
			UserID:         userID,
			ThreadID:       thread.ID,
			TurnID:         turn.ID,
			OperationID:    op.ID,
			IdempotencyKey: fmt.Sprintf("turn:%s:respond", turn.ID),
		}); err != nil {
			return err
		}

		out = TurnAccepted{
			ThreadID: thread.ID, MessageID: message.ID,
			TurnID: turn.ID, OperationID: op.ID,
		}
		return nil
	})
	return out, err
}

// saveEntryContext 保存客户端页面上下文。
//
// 它只用于消歧，执行前仍会重新校验资源归属与版本；
// 客户端不得通过它传入任何权限结论。
func (s *Service) saveEntryContext(ctx context.Context, q *dbgen.Queries,
	turnID string, entry *httpapi.EntryContext) error {

	if entry == nil {
		return nil
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return apperr.Internal(err)
	}
	if err := q.SaveTurnEntryContext(ctx, dbgen.SaveTurnEntryContextParams{
		ID: turnID, ProviderState: raw,
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// CancelTurn 取消仍在执行的回复。
//
// Worker 在下一个检查点看到 cancelled 后不再写入结果。
func (s *Service) CancelTurn(ctx context.Context, userID, turnID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		turn, err := q.GetTurn(ctx, turnID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这次回复")
			}
			return apperr.Internal(err)
		}
		if turn.Status != "queued" && turn.Status != "running" {
			return apperr.New(apperr.CodeAITurnCancelled)
		}
		if _, err := q.CancelTurn(ctx, turnID); err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeAITurnCancelled)
			}
			return apperr.Internal(err)
		}
		if turn.OperationID != nil {
			progress := int32(100)
			if _, err := q.UpdateOperationStatus(ctx, dbgen.UpdateOperationStatusParams{
				ID: *turn.OperationID, Status: "cancelled", Progress: &progress,
			}); err != nil {
				return apperr.Internal(err)
			}
		}
		return nil
	})
}

// ---- Worker ----

// Respond 执行一次回复任务。Worker 调用它。
//
// 外部 Provider 调用不在数据库事务内：先用短事务读上下文，
// 事务外跑工具循环，再用短事务保存结果。
func (s *Service) Respond(ctx context.Context, args RespondArgs) error {
	// 第一步：短事务标记开始并读取最小上下文。
	seed, skip, err := s.loadSeed(ctx, args)
	if err != nil || skip {
		return err
	}

	// 第二步：事务外执行工具循环。工具自己会开短 RLS 事务。
	turnCtx := ai.CapabilityContext{
		UserID:            args.UserID,
		Timezone:          seed.Timezone,
		Now:               time.Now(),
		EntryResourceType: seed.EntryResourceType,
		EntryResourceID:   seed.EntryResourceID,
	}
	result, runErr := s.engine.RunTurn(ctx, ai.TurnRequest{
		RunID:         idgen.New(idgen.PrefixRun),
		UserID:        args.UserID,
		ThreadID:      args.ThreadID,
		TurnID:        args.TurnID,
		SystemPrompt:  s.systemPrompt(seed),
		History:       seed.History,
		UserText:      seed.UserText,
		ContextBlocks: seed.ContextBlocks,
		Capabilities:  s.allowedFor(seed),
		Limits:        ai.DefaultRunLimits(),
		Ctx:           turnCtx,
	})

	// 第三步：短事务保存结果。
	return s.saveTurnResult(ctx, args, result, runErr)
}

// allowedFor 计算本轮交给模型的能力集合。
//
// 用户关掉建议开关时，Proposal 能力整体不出现；关掉偏好学习时，
// 只摘掉记忆建议这一项——他仍然可以让助理帮他改任务，只是不会再被记住习惯。
//
// 这里的裁剪是引导手段，不是唯一的安全边界：每次工具调用前仍会重新授权。
func (s *Service) allowedFor(seed contextSeed) []ai.Capability {
	all := s.registry.Allowed(seed.SuggestionsEnabled)
	if seed.MemoryLearningEnabled {
		return all
	}
	out := make([]ai.Capability, 0, len(all))
	for _, c := range all {
		if c.Name == "memories.propose_upsert" {
			continue
		}
		out = append(out, c)
	}
	return out
}

// systemPrompt 拼出本轮的 System Policy。
//
// 当前时间与时区放在这里而不是让模型自己推断：模型没有时钟，
// 让它猜"今天"是哪天必然出错。
func (s *Service) systemPrompt(seed contextSeed) string {
	var b strings.Builder
	b.WriteString(assets.AssistantPolicyV1)
	b.WriteString("\n\n## 当前时间\n\n")
	fmt.Fprintf(&b, "用户所在时区：%s\n", seed.Timezone)
	fmt.Fprintf(&b, "当前时间：%s（%s）\n",
		seed.Now.Format("2006-01-02 15:04"), weekdayName(seed.Now.Weekday()))
	return b.String()
}

// saveTurnResult 落库回复、工具审计与建议，并完成 Operation。
func (s *Service) saveTurnResult(ctx context.Context, args RespondArgs,
	result ai.TurnResult, runErr error) error {

	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		turn, err := q.GetTurn(ctx, args.TurnID)
		if err != nil {
			return apperr.Internal(err)
		}
		// 用户已取消或本轮已被更新的提问顶替，结果直接丢弃。
		if turn.Status == "cancelled" || turn.Status == "superseded" {
			s.logger.Info("本轮已作废，丢弃回复", "turn_id", args.TurnID, "status", turn.Status)
			return s.finishOperation(ctx, q, args, "cancelled", nil, nil)
		}

		if runErr != nil {
			return s.saveTurnFailure(ctx, q, args, runErr)
		}

		// 工具审计先落库：即使后面的写入失败重试，也已经留下了调用记录。
		for _, call := range result.ToolCalls {
			if err := s.recordToolCall(ctx, q, args, call); err != nil {
				return err
			}
		}

		seq, err := q.AdvanceThreadSeq(ctx, dbgen.AdvanceThreadSeqParams{
			MessageDelta: 1, TurnDelta: 0, ID: args.ThreadID,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		now := time.Now()
		message, err := q.CreateMessage(ctx, dbgen.CreateMessageParams{
			ID:          idgen.New(idgen.PrefixMessage),
			UserID:      args.UserID,
			ThreadID:    args.ThreadID,
			MessageSeq:  seq.LastMessageSeq,
			Role:        "assistant",
			Content:     result.Text,
			Status:      "completed",
			TurnID:      &args.TurnID,
			CompletedAt: &now,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		// 建议在完整校验后才落库；没有通过校验的直接丢弃，不半成品下发。
		if s.proposal != nil {
			for _, draft := range result.Proposals {
				if err := s.proposal.SaveDraft(ctx, q, args.UserID,
					args.ThreadID, args.TurnID, draft); err != nil {
					return err
				}
			}
		}

		mode := result.Mode
		if mode == "" {
			mode = inferMode(result)
		}
		if _, err := q.FinishTurn(ctx, dbgen.FinishTurnParams{
			Status: "succeeded", Mode: &mode,
			AssistantMessageID: &message.ID, ID: args.TurnID,
		}); err != nil {
			return apperr.Internal(err)
		}
		if err := q.TouchThread(ctx, args.ThreadID); err != nil {
			return apperr.Internal(err)
		}

		resultRef, _ := json.Marshal(map[string]any{
			"type":       "assistant_message",
			"thread_id":  args.ThreadID,
			"turn_id":    args.TurnID,
			"message_id": message.ID,
		})
		return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
	})
}

// MarkTurnPermanentlyFailed 在队列放弃重试后收尾。
//
// 没有这一步，保存结果的事务反复失败时用户的 Operation 会永远停在排队中：
// 界面上是一个转不完的圈，而不是一条"这次没成功"。
func (s *Service) MarkTurnPermanentlyFailed(ctx context.Context, args RespondArgs) error {
	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		turn, err := q.GetTurn(ctx, args.TurnID)
		if err != nil {
			return apperr.Internal(err)
		}
		if turn.Status == "succeeded" || turn.Status == "cancelled" {
			return nil
		}
		code := string(apperr.CodeInternal)
		if _, err := q.FinishTurn(ctx, dbgen.FinishTurnParams{
			Status: "failed_permanent", ErrorCode: &code, ID: args.TurnID,
		}); err != nil {
			return apperr.Internal(err)
		}
		errBody, _ := json.Marshal(map[string]any{
			"code":      string(apperr.CodeAIProviderUnavailable),
			"message":   "助理暂时回复不了，请稍后再试。你的其他内容不受影响。",
			"retryable": true,
		})
		progress := int32(100)
		if _, err := q.UpdateOperationStatus(ctx, dbgen.UpdateOperationStatusParams{
			ID: args.OperationID, Status: "failed", Progress: &progress, Error: errBody,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// saveTurnFailure 把 Provider 失败转成用户能理解的说明。
func (s *Service) saveTurnFailure(ctx context.Context, q *dbgen.Queries,
	args RespondArgs, runErr error) error {

	code := apperr.CodeAIProviderUnavailable
	switch {
	case errors.Is(runErr, ai.ErrRateLimited):
		code = apperr.CodeAIProviderRateLimited
	case errors.Is(runErr, ai.ErrTurnCancelled):
		code = apperr.CodeAITurnCancelled
	}
	s.logger.Error("回复失败", "turn_id", args.TurnID, "code", code, "error", runErr)

	appErr := apperr.New(code)
	message := appErr.Message
	if code == apperr.CodeAIProviderUnavailable {
		// 默认文案是给 Capture 写的，对话场景说"智能整理"会让人困惑。
		message = "助理暂时回复不了，请稍后再试。你的其他内容不受影响。"
	}
	errBody, _ := json.Marshal(map[string]any{
		"code": string(code), "message": message, "retryable": appErr.Retryable(),
	})
	codeStr := string(code)
	status := "failed_retryable"
	if code == apperr.CodeAITurnCancelled {
		status = "cancelled"
	}
	if _, err := q.FinishTurn(ctx, dbgen.FinishTurnParams{
		Status: status, ErrorCode: &codeStr, ID: args.TurnID,
	}); err != nil {
		return apperr.Internal(err)
	}
	return s.finishOperation(ctx, q, args, "failed", errBody, nil)
}

// recordToolCall 保存一次工具调用的审计摘要。
//
// 只保存参数与结果的哈希和短摘要：完整参数与结果可能含用户正文，
// 留在审计表里既没有必要也扩大了泄漏面。
func (s *Service) recordToolCall(ctx context.Context, q *dbgen.Queries,
	args RespondArgs, call ai.ToolCallRecord) error {

	risk := string(call.Risk)
	if risk == "" {
		// 未授权的调用没有落到任何已登记能力上，也就没有风险级别可言。
		risk = "denied"
	}
	argsHash := sha256.Sum256([]byte(call.Arguments))
	summary, _ := json.Marshal(call.Summary)
	sources, _ := json.Marshal(call.SourceRefs)
	resultHash := sha256.Sum256([]byte(call.Summary))

	var errCode *string
	if call.ErrorCode != "" {
		errCode = &call.ErrorCode
	}
	if err := q.RecordToolCall(ctx, dbgen.RecordToolCallParams{
		ID:             idgen.New(idgen.PrefixToolCall),
		UserID:         args.UserID,
		TurnID:         args.TurnID,
		CallSeq:        int32(call.Seq),
		CapabilityName: call.Name,
		Risk:           risk,
		ArgumentsHash:  argsHash[:],
		ResultHash:     resultHash[:],
		ResultSummary:  summary,
		SourceRefs:     sources,
		Status:         call.Status,
		ErrorCode:      errCode,
		DurationMs:     int32(call.DurationMS),
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// finishOperation 更新异步任务状态并登记幂等结果。
func (s *Service) finishOperation(ctx context.Context, q *dbgen.Queries,
	args RespondArgs, status string, errBody, resultRef []byte) error {

	progress := int32(100)
	if _, err := q.UpdateOperationStatus(ctx, dbgen.UpdateOperationStatusParams{
		ID: args.OperationID, Status: status, Progress: &progress,
		ResultRef: resultRef, Error: errBody,
	}); err != nil {
		return apperr.Internal(err)
	}
	if err := q.SaveProcessedJob(ctx, dbgen.SaveProcessedJobParams{
		IdempotencyKey: args.IdempotencyKey,
		UserID:         args.UserID,
		Kind:           "assistant.respond",
		ResultRef:      resultRef,
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// inferMode 从执行结果反推本轮属于哪种交互，仅用于审计与展示。
//
// 取值与 assistant_turns.mode 的约束保持一致：conversation / query / capture / mutation。
func inferMode(result ai.TurnResult) string {
	if len(result.Proposals) > 0 {
		return "mutation"
	}
	if len(result.ToolCalls) > 0 {
		return "query"
	}
	return "conversation"
}

func weekdayName(d time.Weekday) string {
	return [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[d]
}
