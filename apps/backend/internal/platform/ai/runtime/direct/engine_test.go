package direct

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/internal/conformancetest"
)

// Engine Conformance Test（后端指南 23.3）。
//
// 这些用例检查的是编排层的硬不变量，与具体 Provider 无关：
// 换成任何一个实现 ai.OrchestrationEngine 的引擎，都应当同样通过。

func TestEngineConformance(t *testing.T) {
	conformancetest.Run(t, func(provider ai.ChatProvider, logger *slog.Logger) ai.OrchestrationEngine {
		return New(provider, logger)
	})
}

// scriptedProvider 按脚本依次返回预设结果，用于精确控制轮次。
type scriptedProvider struct {
	steps []ai.CompletionResult
	err   error
	calls int
	// seen 记录每次请求时模型收到的工具列表，用于断言允许集合。
	seen [][]ai.ToolSpec
}

func (p *scriptedProvider) Complete(_ context.Context, req ai.CompletionRequest) (ai.CompletionResult, error) {
	p.seen = append(p.seen, req.Tools)
	if p.err != nil {
		return ai.CompletionResult{}, p.err
	}
	if p.calls >= len(p.steps) {
		// 脚本用尽时给一个最终回答，避免测试因为脚本写短了而无限循环。
		return ai.CompletionResult{Content: "脚本已结束"}, nil
	}
	step := p.steps[p.calls]
	p.calls++
	return step, nil
}

func (p *scriptedProvider) Name() string { return "scripted" }

func (p *scriptedProvider) ModelName() string { return "scripted" }

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// countingCapability 返回一个记录调用次数的只读能力。
func countingCapability(name string, calls *int) ai.Capability {
	return ai.Capability{
		Name:           name,
		Description:    "测试能力",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 1 << 10,
		Timeout:        time.Second,
		Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
			*calls++
			return ai.CapabilityResult{Content: `{"ok":true}`, SourceRefs: []string{"task:tsk_1"}}, nil
		},
	}
}

func toolCall(id, name, args string) ai.ToolCall {
	return ai.ToolCall{ID: id, Name: name, Arguments: args}
}

func baseRequest(capabilities []ai.Capability, steps ...ai.CompletionResult) (ai.TurnRequest, *scriptedProvider) {
	provider := &scriptedProvider{steps: steps}
	req := ai.TurnRequest{
		TurnID:       "atrn_test",
		UserID:       "usr_test",
		SystemPrompt: "测试策略",
		UserText:     "这周有什么要做的？",
		Capabilities: capabilities,
		Limits:       ai.DefaultRunLimits(),
		Ctx:          ai.CapabilityContext{UserID: "usr_test", Timezone: "Asia/Shanghai"},
	}
	return req, provider
}

// 模型直接给出最终回答时不应调用任何工具。
func TestRunTurnReturnsFinalAnswer(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{Content: "你这周有三件事。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if result.Text != "你这周有三件事。" {
		t.Errorf("回答不对：%q", result.Text)
	}
	if result.Degraded {
		t.Error("正常回答不该标记为降级")
	}
	if calls != 0 {
		t.Errorf("不该调用工具，实际调用 %d 次", calls)
	}
}

// 工具结果必须交回模型，并由模型给出最终回答。
func TestRunTurnExecutesToolThenAnswers(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c1", "tasks.search", `{"status":["todo"]}`)}},
		ai.CompletionResult{Content: "有一件事：写周报。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if calls != 1 {
		t.Errorf("应当调用工具一次，实际 %d 次", calls)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("应当记录一条工具审计，实际 %d 条", len(result.ToolCalls))
	}
	record := result.ToolCalls[0]
	if record.Status != "succeeded" {
		t.Errorf("状态应为 succeeded，实际 %q", record.Status)
	}
	if len(record.SourceRefs) != 1 || record.SourceRefs[0] != "task:tsk_1" {
		t.Errorf("来源没有记录下来：%v", record.SourceRefs)
	}
	if result.Mode != "" {
		t.Errorf("Mode 由调用方判定，引擎不该自行填写：%q", result.Mode)
	}
}

// 停止条件：模型请求未授权工具时必须拒绝，且不能中断整轮。
func TestRunTurnDeniesUnauthorizedTool(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c1", "db.execute_sql", `{"sql":"select 1"}`)}},
		ai.CompletionResult{Content: "我查不到这个。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if calls != 0 {
		t.Error("未授权的能力不该被执行")
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("应当记录一条被拒审计，实际 %d 条", len(result.ToolCalls))
	}
	if got := result.ToolCalls[0]; got.Status != "denied" || got.ErrorCode != "AI_TOOL_NOT_ALLOWED" {
		t.Errorf("应当记为 denied/AI_TOOL_NOT_ALLOWED，实际 %s/%s", got.Status, got.ErrorCode)
	}
	if result.Text != "我查不到这个。" {
		t.Errorf("被拒之后仍应继续这一轮，实际回答 %q", result.Text)
	}
}

// 停止条件：同一工具与规范化参数重复调用。
func TestRunTurnRejectsRepeatedIdenticalCall(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c1", "tasks.search", `{"status":["todo"]}`)}},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c2", "tasks.search", `{"status":["todo"]}`)}},
		ai.CompletionResult{Content: "还是那三件事。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if calls != 1 {
		t.Errorf("重复调用应当被拦下，实际执行 %d 次", calls)
	}
	if len(result.ToolCalls) != 2 {
		t.Fatalf("两次调用都要留审计，实际 %d 条", len(result.ToolCalls))
	}
	if got := result.ToolCalls[1]; got.ErrorCode != "AI_TOOL_LOOP_LIMIT" {
		t.Errorf("第二次应记为 AI_TOOL_LOOP_LIMIT，实际 %q", got.ErrorCode)
	}
}

// 参数键序不同但语义相同，同样算重复调用。
func TestRunTurnNormalizesArgumentsBeforeComparing(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{
			toolCall("c1", "tasks.search", `{"limit":10,"status":["todo"]}`)}},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{
			toolCall("c2", "tasks.search", `{"status":["todo"],"limit":10}`)}},
		ai.CompletionResult{Content: "结果没变。"},
	)

	if _, err := New(provider, quietLogger()).RunTurn(context.Background(), req); err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if calls != 1 {
		t.Errorf("键序不同不构成新的调用，实际执行 %d 次", calls)
	}
}

// 停止条件：达到 max_tool_rounds 时必须停下并给降级回答。
func TestRunTurnStopsAtRoundLimit(t *testing.T) {
	var calls int
	// 模型每一轮都只会继续要工具，永远不给最终回答。
	steps := make([]ai.CompletionResult, 10)
	for i := range steps {
		steps[i] = ai.CompletionResult{ToolCalls: []ai.ToolCall{
			toolCall("c", "tasks.search", `{"page":`+string(rune('0'+i))+`}`)}}
	}
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)}, steps...)
	req.Limits = ai.RunLimits{MaxToolRounds: 2, MaxToolCalls: 8, MaxDuration: time.Minute}

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if !result.Degraded {
		t.Error("达到轮数上限必须标记为降级")
	}
	if provider.calls > 2 {
		t.Errorf("最多调用模型 2 轮，实际 %d 轮", provider.calls)
	}
	if result.Text == "" {
		t.Error("降级时也要给用户一句话，不能返回空回答")
	}
}

// 停止条件：达到 max_tool_calls。
func TestRunTurnStopsAtCallLimit(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{
			toolCall("c1", "tasks.search", `{"a":1}`),
			toolCall("c2", "tasks.search", `{"a":2}`),
			toolCall("c3", "tasks.search", `{"a":3}`),
		}},
		ai.CompletionResult{Content: "不该走到这里"},
	)
	req.Limits = ai.RunLimits{MaxToolRounds: 4, MaxToolCalls: 2, MaxDuration: time.Minute}

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if calls != 2 {
		t.Errorf("最多执行 2 次工具，实际 %d 次", calls)
	}
	if !result.Degraded {
		t.Error("达到调用上限必须标记为降级")
	}
}

// 停止条件：用户已取消这一轮。
func TestRunTurnReturnsCancelled(t *testing.T) {
	var calls int
	req, provider := baseRequest(
		[]ai.Capability{countingCapability("tasks.search", &calls)},
		ai.CompletionResult{Content: "不该走到这里"},
	)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := New(provider, quietLogger()).RunTurn(ctx, req)
	if !errors.Is(err, ai.ErrTurnCancelled) {
		t.Fatalf("应当返回 ErrTurnCancelled，实际 %v", err)
	}
	if provider.calls != 0 {
		t.Error("已取消的轮次不该再调用模型")
	}
}

// Provider 在第一轮就不可用时整体失败，不能编一个回答。
func TestRunTurnFailsWhenProviderUnavailable(t *testing.T) {
	provider := &scriptedProvider{err: ai.ErrProviderUnavailable}
	req, _ := baseRequest(nil)

	_, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if !errors.Is(err, ai.ErrProviderUnavailable) {
		t.Fatalf("应当把 Provider 错误透出，实际 %v", err)
	}
}

// 工具失败时交回模型的提示必须明确要求不要编造。
func TestRunTurnTellsModelNotToFabricateOnToolFailure(t *testing.T) {
	failing := ai.Capability{
		Name: "tasks.search", Risk: ai.RiskReadOnly,
		MaxResultBytes: 1 << 10, Timeout: time.Second,
		Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
			return ai.CapabilityResult{}, errors.New("数据库挂了")
		},
	}
	req, provider := baseRequest(
		[]ai.Capability{failing},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c1", "tasks.search", `{}`)}},
		ai.CompletionResult{Content: "我暂时查不到。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("单个工具失败不该让整轮失败：%v", err)
	}
	if got := result.ToolCalls[0]; got.Status != "failed" || got.ErrorCode != "AI_TOOL_FAILED" {
		t.Errorf("应记为 failed/AI_TOOL_FAILED，实际 %s/%s", got.Status, got.ErrorCode)
	}
}

// 允许集合里没有 Proposal 能力时，模型也不该在工具列表里看到它。
func TestAllowedSetExcludesProposalsWhenDisabled(t *testing.T) {
	registry := ai.NewRegistry()
	var calls int
	registry.Register(countingCapability("tasks.search", &calls))
	registry.Register(ai.Capability{
		Name: "tasks.propose_create", Risk: ai.RiskProposal,
		Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
			return ai.CapabilityResult{}, nil
		},
	})

	readOnly := registry.Allowed(false)
	if len(readOnly) != 1 || readOnly[0].Name != "tasks.search" {
		t.Fatalf("关闭建议时只应剩只读能力，实际 %v", names(readOnly))
	}
	if all := registry.Allowed(true); len(all) != 2 {
		t.Fatalf("打开建议时应有两个能力，实际 %v", names(all))
	}
}

// 结果超过上限时截断并告知模型，而不是整体失败。
func TestToolResultIsTruncatedNotDropped(t *testing.T) {
	big := ai.Capability{
		Name: "tasks.search", Risk: ai.RiskReadOnly,
		MaxResultBytes: 32, Timeout: time.Second,
		Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
			return ai.CapabilityResult{Content: strings.Repeat("x", 500)}, nil
		},
	}
	req, provider := baseRequest(
		[]ai.Capability{big},
		ai.CompletionResult{ToolCalls: []ai.ToolCall{toolCall("c1", "tasks.search", `{}`)}},
		ai.CompletionResult{Content: "结果太多了。"},
	)

	result, err := New(provider, quietLogger()).RunTurn(context.Background(), req)
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if result.ToolCalls[0].Status != "succeeded" {
		t.Error("截断不等于失败")
	}
	if !strings.Contains(result.ToolCalls[0].Summary, "截断") {
		t.Errorf("摘要里应当能看出结果被截断了：%q", result.ToolCalls[0].Summary)
	}
}

func names(capabilities []ai.Capability) []string {
	out := make([]string, 0, len(capabilities))
	for _, c := range capabilities {
		out = append(out, c.Name)
	}
	return out
}
