package ai

import (
	"context"
	"time"
)

// ---- 编排引擎的自有接口。业务模块只依赖这里的类型。 ----
//
// 这些类型不包含任何 Provider SDK 或编排框架的具体类型，
// 因此将来换 Provider 或引入 Eino 时，业务层不需要改动。

// Role 是消息角色。
type Role string

// 消息角色取值。
const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

// Message 是一条中立的对话消息。
type Message struct {
	Role    Role
	Content string
	// ToolCalls 只在 RoleAssistant 上出现。
	ToolCalls []ToolCall
	// ToolCallID 只在 RoleTool 上出现，指回发起调用的那条记录。
	ToolCallID string
}

// ToolCall 是模型申请的一次能力调用。
type ToolCall struct {
	ID   string
	Name string
	// Arguments 是模型给出的原始 JSON，属于不可信输入，必须校验后再用。
	Arguments string
}

// ToolSpec 是交给 Provider 的能力描述。
type ToolSpec struct {
	Name        string
	Description string
	Parameters  map[string]any
}

// CompletionRequest 是一次模型调用的中立请求。
type CompletionRequest struct {
	Messages        []Message
	Tools           []ToolSpec
	MaxOutputTokens int
}

// CompletionResult 是一次模型调用的中立结果。
type CompletionResult struct {
	Content      string
	ToolCalls    []ToolCall
	Usage        Usage
	FinishReason string
}

// ChatProvider 是编排引擎需要的最小 Provider 能力。
type ChatProvider interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResult, error)
	ModelName() string
}

// StreamingChatProvider 是可选能力：Provider 支持逐段返回时实现它。
//
// 不实现也能正常工作，只是用户要等整段回复生成完才看到内容。
type StreamingChatProvider interface {
	ChatProvider
	// CompleteStream 在生成过程中调用 onDelta 推送文本增量，
	// 最终仍返回与 Complete 相同的完整结果。
	CompleteStream(ctx context.Context, req CompletionRequest, onDelta func(string)) (CompletionResult, error)
}

// TurnSink 接收一次 Turn 的实时进度。
//
// 它只用于把已经决定好的内容更快送到屏幕上，不承载任何权威状态：
// 实现可以丢弃事件，调用方不得依赖它送达。
type TurnSink interface {
	// OnStatus 报告阶段变化，文本是给人看的短标签。
	OnStatus(text string)
	// OnToolCall 报告正在调用某个能力，只给标签，不给参数与结果。
	OnToolCall(label string)
	// OnDelta 报告回复文本增量。
	OnDelta(text string)
}

// RunLimits 是一次 Turn 的硬上限。
//
// 达到任一上限必须立刻停止，并返回已有证据的降级回答；
// 不能为了凑出一句完整的话而编造缺失结果。
type RunLimits struct {
	MaxToolRounds int
	MaxToolCalls  int
	MaxDuration   time.Duration
	MaxTokens     int
}

// DefaultRunLimits 返回保守的默认上限。
func DefaultRunLimits() RunLimits {
	return RunLimits{
		MaxToolRounds: 4,
		MaxToolCalls:  8,
		MaxDuration:   90 * time.Second,
		MaxTokens:     32000,
	}
}

// TurnRequest 是一次 Turn 的中立输入。
type TurnRequest struct {
	RunID    string
	UserID   string
	ThreadID string
	TurnID   string

	SystemPrompt string
	// History 是最近若干轮原始消息，按时间正序。
	History []Message
	// UserText 是本轮用户输入。
	UserText string
	// ContextBlocks 是已确认的业务事实与偏好，按优先级排好序。
	ContextBlocks []string

	Capabilities []Capability
	Limits       RunLimits
	Ctx          CapabilityContext
	// Sink 为空时不推送实时进度，客户端退回轮询。
	Sink TurnSink
}

// ToolCallRecord 是一次工具调用的审计记录。
type ToolCallRecord struct {
	Seq        int
	Name       string
	Risk       CapabilityRisk
	Arguments  string
	Summary    string
	SourceRefs []string
	Status     string
	ErrorCode  string
	DurationMS int
}

// TurnResult 是一次 Turn 的中立输出。
type TurnResult struct {
	Text      string
	ToolCalls []ToolCallRecord
	Proposals []ProposalDraft
	Usage     Usage
	// Mode 记录本轮被判定为哪种交互，仅用于审计与展示。
	Mode string
	// ProviderModel 是这一轮实际用的模型，只用于审计，不参与业务判断。
	ProviderModel string
	// Degraded 为 true 表示因为达到上限或工具失败而给出的降级回答。
	Degraded bool
}

// OrchestrationEngine 是业务模块唯一依赖的编排入口。
type OrchestrationEngine interface {
	RunTurn(ctx context.Context, req TurnRequest) (TurnResult, error)
}
