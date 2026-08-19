package eval

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/memory"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/users"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/direct"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// Stack 是评测用的真实编排栈。
//
// 它按 bootstrap 的同一顺序组装，只把 Provider 换成脚本化的那个：
// 越权拦截、来源校验、确认事务这些都必须是真的实现，
// 否则评测通过了也不说明线上安全。
type Stack struct {
	DB        *database.DB
	Assistant *assistant.Service
	Proposals *assistant.ProposalService
	Memory    *memory.Service
	Objects   *objects.Service
	Trackers  *trackers.Service
	Lists     *lists.Service
	Users     *users.Service
	Registry  *ai.Registry
	provider  *scriptedProvider
}

// NewStack 组装评测栈。
func NewStack(db *database.DB) *Stack {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	activitySvc := activity.New(db)
	listsSvc := lists.New(db)
	usersSvc := users.New(db, listsSvc)
	objectsSvc := objects.New(db, listsSvc, usersSvc, activitySvc)
	trackersSvc := trackers.New(db, usersSvc, activitySvc)
	viewsSvc := views.New(db, usersSvc)
	memorySvc := memory.New(db, []byte("eval-fingerprint-key"))

	proposalSvc := assistant.NewProposalService(db, objectsSvc, listsSvc,
		usersSvc, activitySvc, memorySvc)

	registry := ai.NewRegistry()
	deps := assistant.CapabilityDeps{
		Tasks: objectsSvc, Views: viewsSvc, Records: trackersSvc, Memory: memorySvc,
	}
	assistant.RegisterReadOnly(registry, deps)
	assistant.RegisterProposals(registry, deps)

	provider := &scriptedProvider{}
	engine := direct.New(provider, logger)

	// 队列不参与评测：这里直接调 Respond，不经过 River。
	assistantSvc := assistant.New(db, engine, registry,
		usersSvc, noopEnqueuer{}, proposalSvc, memorySvc, logger)

	return &Stack{
		DB: db, Assistant: assistantSvc, Proposals: proposalSvc,
		Memory: memorySvc, Objects: objectsSvc, Trackers: trackersSvc,
		Lists: listsSvc, Users: usersSvc, Registry: registry,
		provider: provider,
	}
}

// Result 是一条用例跑完之后可以断言的全部观测。
type Result struct {
	// ExecutedTools 是真正执行过的能力。
	ExecutedTools []string
	// DeniedTools 是被拒绝的调用（含未授权、重复调用、参数非法）。
	DeniedTools []string
	// ToolResults 是交回模型的结果文本，用于检查内容是否越界。
	ToolResults []string
	// ToolSources 是工具声明读过的来源。
	ToolSources []string
	// ContextBlocks 是进入 Prompt 的上下文。
	ContextBlocks []string
	Answer        string
	TurnFailed    bool
	TurnError     error

	Proposals []dbgen.ActionProposal
	Memories  []dbgen.MemoryItem

	TasksCreated int
	TasksUpdated int

	ConfirmErr        error
	ConfirmDone       bool
	ReconfirmRejected bool

	// memoriesWithEvidence 是有来源记录的记忆 ID。
	memoriesWithEvidence []string
}

// Run 执行一条用例。
//
// 每条用例都用一个独立的新用户：评测之间不能互相看到数据，
// 否则「跨用户隔离」这类用例会因为顺序不同而时好时坏。
func (s *Stack) Run(ctx context.Context, c Case) (Result, error) {
	var result Result

	userID, err := s.seedUser(ctx)
	if err != nil {
		return result, err
	}
	fixtures, err := s.seedFixtures(ctx, userID, c)
	if err != nil {
		return result, err
	}
	if err := s.applySettings(ctx, userID, c.Settings); err != nil {
		return result, err
	}

	before, err := s.countTasks(ctx, userID)
	if err != nil {
		return result, err
	}

	// 脚本里的占位符替换成本次真实的 ID。
	s.provider.reset(resolveScript(c.Script, fixtures))

	threadID, turnID, operationID, err := s.startTurn(ctx, userID, c.UserText)
	if err != nil {
		return result, err
	}

	// OperationID 必须用 CreateTurn 真的建出来的那一个。
	// 自己造一个 ID 会让收尾时的 UpdateOperationStatus 找不到行，
	// 整轮以 INTERNAL_ERROR 结束——而错误发生在断言之前，
	// 看起来就像"模型什么都没做"。
	respondErr := s.Assistant.Respond(ctx, assistant.RespondArgs{
		SchemaVersion: 1, UserID: userID, ThreadID: threadID, TurnID: turnID,
		OperationID: operationID, IdempotencyKey: "eval:" + turnID,
	})
	result.TurnError = respondErr

	if err := s.collect(ctx, userID, turnID, &result); err != nil {
		return result, err
	}
	result.ContextBlocks = s.provider.systemBlocks

	after, err := s.countTasks(ctx, userID)
	if err != nil {
		return result, err
	}
	result.TasksCreated = after - before

	if c.ConfirmFirstProposal && len(result.Proposals) > 0 {
		s.confirm(ctx, userID, result.Proposals[0], &result)
		// 确认可能写入任务或记忆，重新统计。
		if final, err := s.countTasks(ctx, userID); err == nil {
			result.TasksCreated = final - before
		}
		if memories, evidence, err := s.listMemories(ctx, userID); err == nil {
			result.Memories = memories
			result.memoriesWithEvidence = evidence
		}
	}
	return result, nil
}

// confirm 确认一条建议，并再确认一次以验证重复确认被拒。
func (s *Stack) confirm(ctx context.Context, userID string,
	proposal dbgen.ActionProposal, result *Result) {

	body := httpapi.ConfirmProposalRequest{ProposalVersion: int(proposal.Version)}
	if _, err := s.Proposals.Confirm(ctx, userID, proposal.ID, body); err != nil {
		result.ConfirmErr = err
		return
	}
	result.ConfirmDone = true

	// 同一条建议不能执行两次。
	if _, err := s.Proposals.Confirm(ctx, userID, proposal.ID, body); err != nil {
		result.ReconfirmRejected = true
	}
}

// collect 把这一轮的观测读出来。
func (s *Stack) collect(ctx context.Context, userID, turnID string, result *Result) error {
	return s.DB.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		calls, err := q.ListToolCalls(ctx, turnID)
		if err != nil {
			return err
		}
		for _, call := range calls {
			switch call.Status {
			case "succeeded":
				result.ExecutedTools = append(result.ExecutedTools, call.CapabilityName)
			default:
				result.DeniedTools = append(result.DeniedTools, call.CapabilityName)
			}
			var summary string
			_ = json.Unmarshal(call.ResultSummary, &summary)
			result.ToolResults = append(result.ToolResults, summary)
			var sources []string
			_ = json.Unmarshal(call.SourceRefs, &sources)
			result.ToolSources = append(result.ToolSources, sources...)
		}

		turn, err := q.GetTurn(ctx, turnID)
		if err != nil {
			return err
		}
		result.TurnFailed = turn.Status != "succeeded"
		if turn.AssistantMessageID != nil {
			messages, err := q.ListRecentMessages(ctx, dbgen.ListRecentMessagesParams{
				ThreadID: turn.ThreadID, RowLimit: 5,
			})
			if err != nil {
				return err
			}
			for _, m := range messages {
				if m.ID == *turn.AssistantMessageID {
					result.Answer = m.Content
				}
			}
		}

		proposals, err := q.ListProposals(ctx, dbgen.ListProposalsParams{
			Statuses: []string{"pending", "executed", "rejected", "stale"}, RowLimit: 50,
		})
		if err != nil {
			return err
		}
		result.Proposals = proposals

		memories, err := q.ListMemories(ctx, dbgen.ListMemoriesParams{
			Statuses: []string{"active"}, RowLimit: 50,
		})
		if err != nil {
			return err
		}
		result.Memories = memories
		return nil
	})
}

// listMemories 读出记忆并顺带查出哪些有来源。
//
// 「记住了什么」和「凭什么记住」要一起读：只读前者的话，
// 一条没有来源的记忆看起来和正常的一模一样。
func (s *Stack) listMemories(ctx context.Context, userID string) (
	[]dbgen.MemoryItem, []string, error) {

	var (
		out          []dbgen.MemoryItem
		withEvidence []string
	)
	err := s.DB.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListMemories(ctx, dbgen.ListMemoriesParams{
			Statuses: []string{"active"}, RowLimit: 50,
		})
		if err != nil {
			return err
		}
		out = rows
		for _, row := range rows {
			evidence, err := q.ListMemoryEvidence(ctx, row.ID)
			if err != nil {
				return err
			}
			if len(evidence) > 0 {
				withEvidence = append(withEvidence, row.ID)
			}
		}
		return nil
	})
	return out, withEvidence, err
}

func (s *Stack) countTasks(ctx context.Context, userID string) (int, error) {
	count := 0
	err := s.DB.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses: []string{"todo", "doing", "done"}, RowLimit: 200,
		})
		count = len(rows)
		return err
	})
	return count, err
}

// startTurn 建对话与 Turn。
func (s *Stack) startTurn(ctx context.Context, userID, text string) (
	threadID, turnID, operationID string, err error) {

	thread, err := s.Assistant.CreateThread(ctx, userID, nil, true)
	if err != nil {
		return "", "", "", err
	}
	accepted, err := s.Assistant.CreateTurn(ctx, userID, thread.ID,
		httpapi.CreateTurnRequest{Text: text})
	if err != nil {
		return "", "", "", err
	}
	return thread.ID, accepted.TurnID, accepted.OperationID, nil
}

func (s *Stack) applySettings(ctx context.Context, userID string, settings *Settings) error {
	if settings == nil {
		return nil
	}
	_, err := s.Users.UpdateAiSettings(ctx, userID, httpapi.UpdateAiSettingsRequest{
		CaptureParseEnabled:   settings.CaptureParseEnabled,
		SuggestionEnabled:     settings.SuggestionEnabled,
		MemoryLearningEnabled: settings.MemoryLearningEnabled,
	})
	return err
}

func fmtErr(step string, err error) error {
	return fmt.Errorf("%s：%w", step, err)
}

// noopEnqueuer 让评测直接调用 Respond，不经过队列。
type noopEnqueuer struct{}

func (noopEnqueuer) EnqueueAssistantRespond(context.Context, *dbgen.Queries, assistant.RespondArgs) error {
	return nil
}

// scriptedProvider 按脚本返回模型行为。
//
// 它同时是上下文的观察点：进入 Prompt 的内容就是它收到的内容，
// 这比在服务里额外埋一个钩子更可信——钩子可能和真正发出去的东西不一致。
type scriptedProvider struct {
	script []ai.CompletionResult
	calls  int
	// systemBlocks 是模型实际收到的全部 system 消息。
	systemBlocks []string
}

func (p *scriptedProvider) reset(script []ai.CompletionResult) {
	p.script = script
	p.calls = 0
	p.systemBlocks = nil
}

func (p *scriptedProvider) ModelName() string { return "scripted-eval" }

func (p *scriptedProvider) Complete(_ context.Context, req ai.CompletionRequest) (ai.CompletionResult, error) {
	for _, m := range req.Messages {
		if m.Role == ai.RoleSystem {
			p.systemBlocks = append(p.systemBlocks, m.Content)
		}
	}
	if p.calls >= len(p.script) {
		// 脚本用尽时给一个最终回答，避免评测因为脚本写短了而卡在循环里。
		return ai.CompletionResult{Content: "（脚本结束）"}, nil
	}
	step := p.script[p.calls]
	p.calls++
	return step, nil
}

// resolveScript 把脚本里的占位符替换成本次运行的真实 ID。
func resolveScript(steps []ScriptStep, f seeded) []ai.CompletionResult {
	out := make([]ai.CompletionResult, 0, len(steps))
	for i, step := range steps {
		result := ai.CompletionResult{Content: step.Content}
		for j, call := range step.ToolCalls {
			raw, _ := json.Marshal(call.Arguments)
			text := f.replace(string(raw))
			result.ToolCalls = append(result.ToolCalls, ai.ToolCall{
				ID:        fmt.Sprintf("call_%d_%d", i, j),
				Name:      call.Name,
				Arguments: text,
			})
		}
		out = append(out, result)
	}
	return out
}

// seeded 记录本次运行预置出来的 ID，供脚本占位符替换。
type seeded struct {
	taskIDs  []string
	ledgerID string
}

func (s seeded) replace(text string) string {
	for i, id := range s.taskIDs {
		text = strings.ReplaceAll(text, fmt.Sprintf("$TASK%d", i+1), id)
	}
	if s.ledgerID != "" {
		text = strings.ReplaceAll(text, "$LEDGER", s.ledgerID)
	}
	return text
}
