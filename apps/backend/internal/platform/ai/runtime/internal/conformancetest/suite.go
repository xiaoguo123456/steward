// Package conformancetest 提供所有编排引擎都必须通过的行为契约。
package conformancetest

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// Factory 用同一个 Provider 构造待测编排引擎。
type Factory func(ai.ChatProvider, *slog.Logger) ai.OrchestrationEngine

// Run 对一个编排实现执行共享契约测试。
func Run(t *testing.T, factory Factory) {
	t.Helper()
	t.Run("直接回答", func(t *testing.T) {
		provider := &scriptedProvider{steps: []ai.CompletionResult{{
			Content: "你这周有三件事。",
			Usage:   ai.Usage{InputTokens: 10, CachedInputTokens: 2, OutputTokens: 6},
		}}}
		result, err := factory(provider, quietLogger()).RunTurn(context.Background(), request(nil))
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if result.Text != "你这周有三件事。" || result.Degraded {
			t.Fatalf("最终回答异常：%+v", result)
		}
		if result.Provider != "scripted" || result.ProviderModel != "scripted-v1" {
			t.Fatalf("Provider 审计缺失：%+v", result)
		}
		if result.Usage.InputTokens != 10 || result.Usage.CachedInputTokens != 2 || result.Usage.OutputTokens != 6 {
			t.Fatalf("用量汇总异常：%+v", result.Usage)
		}
	})

	t.Run("上下文与历史不丢失", func(t *testing.T) {
		provider := &scriptedProvider{steps: []ai.CompletionResult{{Content: "收到。"}}}
		req := request(nil)
		req.ContextBlocks = []string{"偏好：上午安排专注任务"}
		req.History = []ai.Message{
			{Role: ai.RoleUser, Content: "我喜欢上午处理难题。"},
			{Role: ai.RoleAssistant, Content: "记住了。"},
		}
		if _, err := factory(provider, quietLogger()).RunTurn(context.Background(), req); err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if len(provider.seenMessages) != 1 {
			t.Fatalf("应调用 Provider 一次，实际 %d 次", len(provider.seenMessages))
		}
		messages := provider.seenMessages[0]
		for _, want := range []struct {
			role    ai.Role
			content string
		}{
			{ai.RoleSystem, "测试策略"},
			{ai.RoleSystem, "偏好：上午安排专注任务"},
			{ai.RoleUser, "我喜欢上午处理难题。"},
			{ai.RoleAssistant, "记住了。"},
			{ai.RoleUser, "这周有什么要做的？"},
		} {
			if !containsMessage(messages, want.role, want.content) {
				t.Fatalf("Provider 上下文缺少 %s/%q：%+v", want.role, want.content, messages)
			}
		}
	})

	t.Run("流式增量继续走现有 Sink", func(t *testing.T) {
		provider := &scriptedStreamingProvider{scriptedProvider: scriptedProvider{
			steps: []ai.CompletionResult{{Content: "流式回答"}},
		}}
		sink := &recordingSink{}
		req := request(nil)
		req.Sink = sink
		result, err := factory(provider, quietLogger()).RunTurn(context.Background(), req)
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if provider.streamCalls != 1 || result.Text != "流式回答" {
			t.Fatalf("没有使用流式 Provider：calls=%d result=%+v", provider.streamCalls, result)
		}
		if len(sink.deltas) != 1 || sink.deltas[0] != "流式回答" {
			t.Fatalf("流式增量没有送达 Sink：%v", sink.deltas)
		}
	})

	t.Run("调用工具后回答", func(t *testing.T) {
		calls := 0
		provider := &scriptedProvider{steps: []ai.CompletionResult{
			{ToolCalls: []ai.ToolCall{{ID: "c1", Name: "tasks.search", Arguments: `{"status":["todo"]}`}}},
			{Content: "有一件事：写周报。"},
		}}
		result, err := factory(provider, quietLogger()).RunTurn(
			context.Background(), request([]ai.Capability{countingCapability("tasks.search", &calls)}))
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if calls != 1 || result.Text != "有一件事：写周报。" {
			t.Fatalf("工具循环异常：calls=%d result=%+v", calls, result)
		}
		if len(result.ToolCalls) != 1 || result.ToolCalls[0].Status != "succeeded" {
			t.Fatalf("工具审计异常：%+v", result.ToolCalls)
		}
		if len(result.ToolCalls[0].SourceRefs) != 1 || result.ToolCalls[0].SourceRefs[0] != "task:tsk_1" {
			t.Fatalf("来源审计异常：%+v", result.ToolCalls[0].SourceRefs)
		}
		if len(provider.seen) < 1 || len(provider.seen[0]) != 1 || provider.seen[0][0].Name != "tasks.search" {
			t.Fatalf("模型看到的允许能力异常：%+v", provider.seen)
		}
		if provider.seen[0][0].Parameters["type"] != "object" {
			t.Fatalf("工具参数 Schema 在适配时丢失：%+v", provider.seen[0][0].Parameters)
		}
	})

	t.Run("建议只作为草稿返回", func(t *testing.T) {
		provider := &scriptedProvider{steps: []ai.CompletionResult{
			{ToolCalls: []ai.ToolCall{{ID: "c1", Name: "tasks.propose_create", Arguments: `{"title":"写周报"}`}}},
			{Content: "我整理了一条待确认建议。"},
		}}
		capability := ai.Capability{
			Name: "tasks.propose_create", Description: "构造任务建议", Risk: ai.RiskProposal,
			Parameters: map[string]any{"type": "object"}, MaxResultBytes: 1 << 10, Timeout: time.Second,
			Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
				return ai.CapabilityResult{
					Content: `{"proposal":"draft"}`,
					Proposals: []ai.ProposalDraft{{
						Type: "task_create", Command: map[string]any{"title": "写周报"},
						Preview: ai.ProposalPreview{Title: "写周报"},
					}},
				}, nil
			},
		}
		result, err := factory(provider, quietLogger()).RunTurn(
			context.Background(), request([]ai.Capability{capability}))
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if len(result.Proposals) != 1 || result.Proposals[0].Type != "task_create" {
			t.Fatalf("建议草稿没有保留：%+v", result.Proposals)
		}
	})

	t.Run("拒绝未授权工具", func(t *testing.T) {
		calls := 0
		provider := &scriptedProvider{steps: []ai.CompletionResult{
			{ToolCalls: []ai.ToolCall{{ID: "c1", Name: "db.execute_sql", Arguments: `{"sql":"select 1"}`}}},
			{Content: "我不能执行这个操作。"},
		}}
		result, err := factory(provider, quietLogger()).RunTurn(
			context.Background(), request([]ai.Capability{countingCapability("tasks.search", &calls)}))
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if calls != 0 || len(result.ToolCalls) != 1 {
			t.Fatalf("未授权工具不应执行：calls=%d records=%+v", calls, result.ToolCalls)
		}
		got := result.ToolCalls[0]
		if got.Status != "denied" || got.ErrorCode != "AI_TOOL_NOT_ALLOWED" {
			t.Fatalf("拒绝审计异常：%+v", got)
		}
	})

	t.Run("拦截规范化后的重复调用", func(t *testing.T) {
		calls := 0
		provider := &scriptedProvider{steps: []ai.CompletionResult{
			{ToolCalls: []ai.ToolCall{{ID: "c1", Name: "tasks.search", Arguments: `{"limit":10,"status":["todo"]}`}}},
			{ToolCalls: []ai.ToolCall{{ID: "c2", Name: "tasks.search", Arguments: `{"status":["todo"],"limit":10}`}}},
			{Content: "结果没有变化。"},
		}}
		result, err := factory(provider, quietLogger()).RunTurn(
			context.Background(), request([]ai.Capability{countingCapability("tasks.search", &calls)}))
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if calls != 1 || len(result.ToolCalls) != 2 {
			t.Fatalf("重复调用拦截异常：calls=%d records=%+v", calls, result.ToolCalls)
		}
		if result.ToolCalls[1].ErrorCode != "AI_TOOL_LOOP_LIMIT" {
			t.Fatalf("重复调用错误码异常：%+v", result.ToolCalls[1])
		}
	})

	t.Run("单轮预算耗尽时降级", func(t *testing.T) {
		calls := 0
		provider := &scriptedProvider{steps: []ai.CompletionResult{{
			ToolCalls: []ai.ToolCall{
				{ID: "c1", Name: "tasks.search", Arguments: `{"page":1}`},
				{ID: "c2", Name: "tasks.search", Arguments: `{"page":2}`},
			},
		}}}
		req := request([]ai.Capability{countingCapability("tasks.search", &calls)})
		req.Limits = ai.RunLimits{MaxToolRounds: 4, MaxToolCalls: 1, MaxDuration: time.Minute, MaxTokens: 1000}
		result, err := factory(provider, quietLogger()).RunTurn(context.Background(), req)
		if err != nil {
			t.Fatalf("不该出错：%v", err)
		}
		if calls != 1 || !result.Degraded || result.Text == "" {
			t.Fatalf("单轮预算降级异常：calls=%d result=%+v", calls, result)
		}
	})

	t.Run("取消轮次", func(t *testing.T) {
		provider := &scriptedProvider{steps: []ai.CompletionResult{{Content: "不该返回"}}}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := factory(provider, quietLogger()).RunTurn(ctx, request(nil))
		if !errors.Is(err, ai.ErrTurnCancelled) {
			t.Fatalf("应返回 ErrTurnCancelled，实际 %v", err)
		}
		if provider.calls != 0 {
			t.Fatalf("取消后不应调用 Provider，实际 %d 次", provider.calls)
		}
	})

	t.Run("首轮 Provider 失败不编造", func(t *testing.T) {
		provider := &scriptedProvider{err: ai.ErrProviderUnavailable}
		_, err := factory(provider, quietLogger()).RunTurn(context.Background(), request(nil))
		if !errors.Is(err, ai.ErrProviderUnavailable) {
			t.Fatalf("应透出 Provider 错误，实际 %v", err)
		}
	})
}

type scriptedProvider struct {
	steps        []ai.CompletionResult
	err          error
	calls        int
	seen         [][]ai.ToolSpec
	seenMessages [][]ai.Message
}

func (p *scriptedProvider) Complete(_ context.Context, req ai.CompletionRequest) (ai.CompletionResult, error) {
	p.seen = append(p.seen, req.Tools)
	p.seenMessages = append(p.seenMessages, req.Messages)
	if p.err != nil {
		return ai.CompletionResult{}, p.err
	}
	if p.calls >= len(p.steps) {
		return ai.CompletionResult{Content: "脚本已结束"}, nil
	}
	step := p.steps[p.calls]
	p.calls++
	return step, nil
}

func (p *scriptedProvider) Name() string      { return "scripted" }
func (p *scriptedProvider) ModelName() string { return "scripted-v1" }

type scriptedStreamingProvider struct {
	scriptedProvider
	streamCalls int
}

func (p *scriptedStreamingProvider) CompleteStream(ctx context.Context, req ai.CompletionRequest,
	onDelta func(string)) (ai.CompletionResult, error) {
	p.streamCalls++
	result, err := p.Complete(ctx, req)
	if err == nil && result.Content != "" {
		onDelta(result.Content)
	}
	return result, err
}

type recordingSink struct {
	deltas []string
}

func (*recordingSink) OnStatus(string)   {}
func (*recordingSink) OnToolCall(string) {}
func (s *recordingSink) OnDelta(delta string) {
	s.deltas = append(s.deltas, delta)
}

func request(capabilities []ai.Capability) ai.TurnRequest {
	return ai.TurnRequest{
		TurnID:       "atrn_contract",
		UserID:       "usr_contract",
		SystemPrompt: "测试策略",
		UserText:     "这周有什么要做的？",
		Capabilities: capabilities,
		Limits:       ai.DefaultRunLimits(),
		Ctx:          ai.CapabilityContext{UserID: "usr_contract", Timezone: "Asia/Shanghai"},
	}
}

func countingCapability(name string, calls *int) ai.Capability {
	return ai.Capability{
		Name: name, Description: "测试能力", Risk: ai.RiskReadOnly,
		Parameters:     map[string]any{"type": "object", "additionalProperties": true},
		MaxResultBytes: 1 << 10, Timeout: time.Second,
		Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
			*calls++
			return ai.CapabilityResult{Content: `{"ok":true}`, SourceRefs: []string{"task:tsk_1"}}, nil
		},
	}
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func containsMessage(messages []ai.Message, role ai.Role, content string) bool {
	for _, message := range messages {
		if message.Role == role && strings.Contains(message.Content, content) {
			return true
		}
	}
	return false
}
