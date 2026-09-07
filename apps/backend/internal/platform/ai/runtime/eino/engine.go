// Package eino 使用 CloudWeGo Eino ADK 实现单 Agent 编排。
//
// Eino 只接管单次 Turn 内的「模型 → 工具 → 模型」循环。用户身份、能力授权、
// Proposal 确认、领域校验、会话与审计仍由项目自有代码负责；框架状态不是权威状态。
package eino

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	einodk "github.com/cloudwego/eino/adk"
	einomodel "github.com/cloudwego/eino/components/model"
	einotool "github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	einoschema "github.com/cloudwego/eino/schema"
	einojsonschema "github.com/eino-contrib/jsonschema"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

const (
	engineType    = "eino"
	engineVersion = "eino-adk@v0.9.19"
	agentName     = "steward_assistant"
)

var (
	errTokenBudgetExceeded = errors.New("本轮 token 预算已用尽")
	errToolBudgetExceeded  = errors.New("本轮工具调用次数已用尽")
)

// Engine 用一个 ChatModelAgent 执行当前用户的一次对话轮次。
type Engine struct {
	provider ai.ChatProvider
	logger   *slog.Logger
}

// New 构造 Eino 单 Agent 引擎。
func New(provider ai.ChatProvider, logger *slog.Logger) *Engine {
	if logger == nil {
		logger = slog.Default()
	}
	return &Engine{provider: provider, logger: logger}
}

// Type 返回引擎类型，写入 Turn 与 AI Action 审计。
func (e *Engine) Type() string { return engineType }

// Version 返回框架与适配层版本，便于灰度比较和快速回滚。
func (e *Engine) Version() string { return engineVersion }

// RunTurn 执行一次单 Agent 对话。用户可以无限次继续对话；这里的上限只约束
// 单次后台执行，防止模型在一次请求中无限调用工具。
func (e *Engine) RunTurn(ctx context.Context, req ai.TurnRequest) (ai.TurnResult, error) {
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.Canceled) {
			return ai.TurnResult{}, ai.ErrTurnCancelled
		}
		return ai.TurnResult{}, err
	}

	limits := req.Limits
	if limits.MaxToolRounds <= 0 {
		limits = ai.DefaultRunLimits()
	}

	runCtx, cancel := context.WithTimeout(ctx, limits.MaxDuration)
	defer cancel()

	state := newRunState(req, limits, e.provider, e.logger)
	runCtx = context.WithValue(runCtx, runStateKey{}, state)

	tools, err := newCapabilityTools(req.Capabilities)
	if err != nil {
		return ai.TurnResult{}, fmt.Errorf("构造 Eino 工具失败: %w", err)
	}

	agent, err := einodk.NewChatModelAgent(runCtx, &einodk.ChatModelAgentConfig{
		Name:        agentName,
		Description: "序事的个人事务管家，只能使用本轮明确授权的查询和建议工具。",
		Model:       &providerModel{provider: e.provider},
		ToolsConfig: einodk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{
			Tools:               tools,
			ExecuteSequentially: true,
			UnknownToolsHandler: state.handleUnknownTool,
		}},
		MaxIterations: limits.MaxToolRounds,
	})
	if err != nil {
		return ai.TurnResult{}, fmt.Errorf("构造 Eino Agent 失败: %w", err)
	}

	runner := einodk.NewRunner(runCtx, einodk.RunnerConfig{
		Agent: agent,
		// Provider Adapter 继续使用项目现有的流式协议，把增量直接送到 TurnSink。
		// Runner 本身使用非流式事件，避免同一段文本被推送两次。
		EnableStreaming: false,
	})

	var finalText string
	iterator := runner.Run(runCtx, buildMessages(req))
	for {
		event, ok := iterator.Next()
		if !ok {
			break
		}
		if event == nil {
			continue
		}
		if event.Err != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return ai.TurnResult{}, ai.ErrTurnCancelled
			}
			if errors.Is(event.Err, einodk.ErrExceedMaxIterations) ||
				errors.Is(event.Err, errTokenBudgetExceeded) ||
				errors.Is(event.Err, errToolBudgetExceeded) || state.hasToolCalls() {
				state.markDegraded()
				e.logger.Warn("Eino Agent 提前结束，使用已有证据降级回答",
					"turn_id", req.TurnID, "error", event.Err)
				break
			}
			return ai.TurnResult{}, event.Err
		}

		if event.Output == nil || event.Output.MessageOutput == nil {
			continue
		}
		output := event.Output.MessageOutput
		if output.Role != einoschema.Assistant {
			continue
		}
		message, getErr := output.GetMessage()
		if getErr != nil {
			if state.hasToolCalls() {
				state.markDegraded()
				break
			}
			return ai.TurnResult{}, getErr
		}
		// 带 ToolCall 的 Assistant 消息只是中间决策，不是给用户的最终回答。
		if message != nil && len(message.ToolCalls) == 0 {
			finalText = strings.TrimSpace(message.Content)
		}
	}

	result := state.result()
	result.Text = finalText
	if result.Text == "" {
		result.Text = "我这次没能把信息查全，先把已经确认的部分告诉你。如果需要，可以再问我一次。"
		result.Degraded = true
	}
	return result, nil
}

type runStateKey struct{}

// runState 只活在一次 RunTurn 内，不进入数据库或 Eino checkpoint。
type runState struct {
	mu sync.Mutex

	req      ai.TurnRequest
	limits   ai.RunLimits
	provider ai.ChatProvider
	logger   *slog.Logger

	usage          ai.Usage
	toolCalls      []ai.ToolCallRecord
	proposals      []ai.ProposalDraft
	seenCalls      map[string]bool
	totalCalls     int
	degraded       bool
	trustedSources map[string]bool
}

func newRunState(req ai.TurnRequest, limits ai.RunLimits, provider ai.ChatProvider, logger *slog.Logger) *runState {
	return &runState{
		req: req, limits: limits, provider: provider, logger: logger,
		seenCalls: make(map[string]bool), trustedSources: make(map[string]bool),
	}
}

func stateFromContext(ctx context.Context) (*runState, error) {
	state, ok := ctx.Value(runStateKey{}).(*runState)
	if !ok || state == nil {
		return nil, errors.New("缺少 Eino 单轮运行状态")
	}
	return state, nil
}

func (s *runState) beforeModelCall() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.limits.MaxTokens > 0 && s.usage.InputTokens+s.usage.OutputTokens >= s.limits.MaxTokens {
		s.degraded = true
		return errTokenBudgetExceeded
	}
	return nil
}

func (s *runState) addUsage(usage ai.Usage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.usage.InputTokens += usage.InputTokens
	s.usage.CachedInputTokens += usage.CachedInputTokens
	s.usage.OutputTokens += usage.OutputTokens
	s.usage.LatencyMS += usage.LatencyMS
}

func (s *runState) claimToolCall() (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.totalCalls >= s.limits.MaxToolCalls {
		s.degraded = true
		return 0, false
	}
	s.totalCalls++
	return s.totalCalls, true
}

func (s *runState) seen(fingerprint string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.seenCalls[fingerprint] {
		return true
	}
	s.seenCalls[fingerprint] = true
	return false
}

func (s *runState) appendRecord(record ai.ToolCallRecord, proposals []ai.ProposalDraft) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.toolCalls = append(s.toolCalls, record)
	if record.Status == "succeeded" {
		if record.Risk == ai.RiskReadOnly {
			for _, ref := range record.SourceRefs {
				s.trustedSources[ref] = true
			}
		}
		s.proposals = append(s.proposals, proposals...)
	}
}

func (s *runState) markDegraded() {
	s.mu.Lock()
	s.degraded = true
	s.mu.Unlock()
}

func (s *runState) hasToolCalls() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.toolCalls) > 0
}

func (s *runState) result() ai.TurnResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	return ai.TurnResult{
		ToolCalls:     append([]ai.ToolCallRecord(nil), s.toolCalls...),
		Proposals:     append([]ai.ProposalDraft(nil), s.proposals...),
		Usage:         s.usage,
		Provider:      s.provider.Name(),
		ProviderModel: s.provider.ModelName(),
		Degraded:      s.degraded,
	}
}

func (s *runState) handleUnknownTool(_ context.Context, name, input string) (string, error) {
	seq, ok := s.claimToolCall()
	if !ok {
		return "", errToolBudgetExceeded
	}
	record := ai.ToolCallRecord{
		Seq: seq, Name: name, Arguments: input,
		Status: "denied", ErrorCode: "AI_TOOL_NOT_ALLOWED",
	}
	s.appendRecord(record, nil)
	s.logger.Warn("模型请求了未授权的能力", "turn_id", s.req.TurnID, "capability", name)
	return "这个能力不可用，请改用其他方式回答。", nil
}

// providerModel 把项目已有 ChatProvider 适配成 Eino ToolCallingChatModel。
// Qwen 的 BaseURL、工具名映射、流式 usage 和 enable_thinking=false 仍由原 Provider 负责。
type providerModel struct {
	provider ai.ChatProvider
	tools    []*einoschema.ToolInfo
}

var _ einomodel.ToolCallingChatModel = (*providerModel)(nil)

func (m *providerModel) WithTools(tools []*einoschema.ToolInfo) (einomodel.ToolCallingChatModel, error) {
	return &providerModel{provider: m.provider, tools: append([]*einoschema.ToolInfo(nil), tools...)}, nil
}

func (m *providerModel) Generate(ctx context.Context, input []*einoschema.Message,
	opts ...einomodel.Option) (*einoschema.Message, error) {

	state, err := stateFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if err := state.beforeModelCall(); err != nil {
		return nil, err
	}

	options := einomodel.GetCommonOptions(nil, opts...)
	toolInfos := m.tools
	if options.Tools != nil {
		toolInfos = options.Tools
	}
	toolSpecs, err := toolSpecsFromEino(toolInfos)
	if err != nil {
		return nil, err
	}

	request := ai.CompletionRequest{
		Messages: messagesFromEino(input),
		Tools:    toolSpecs,
	}
	if options.MaxTokens != nil {
		request.MaxOutputTokens = *options.MaxTokens
	}

	var completion ai.CompletionResult
	if streaming, ok := m.provider.(ai.StreamingChatProvider); ok && state.req.Sink != nil {
		completion, err = streaming.CompleteStream(ctx, request, state.req.Sink.OnDelta)
	} else {
		completion, err = m.provider.Complete(ctx, request)
	}
	if err != nil {
		return nil, err
	}
	state.addUsage(completion.Usage)

	message := einoschema.AssistantMessage(completion.Content, toolCallsToEino(completion.ToolCalls))
	message.ResponseMeta = &einoschema.ResponseMeta{
		FinishReason: completion.FinishReason,
		Usage: &einoschema.TokenUsage{
			PromptTokens: completion.Usage.InputTokens,
			PromptTokenDetails: einoschema.PromptTokenDetails{
				CachedTokens: completion.Usage.CachedInputTokens,
			},
			CompletionTokens: completion.Usage.OutputTokens,
			TotalTokens:      completion.Usage.InputTokens + completion.Usage.OutputTokens,
		},
	}
	return message, nil
}

func (m *providerModel) Stream(ctx context.Context, input []*einoschema.Message,
	opts ...einomodel.Option) (*einoschema.StreamReader[*einoschema.Message], error) {

	message, err := m.Generate(ctx, input, opts...)
	if err != nil {
		return nil, err
	}
	return einoschema.StreamReaderFromArray([]*einoschema.Message{message}), nil
}

type capabilityTool struct {
	capability ai.Capability
	info       *einoschema.ToolInfo
	validator  *jsonschema.Schema
}

var _ einotool.InvokableTool = (*capabilityTool)(nil)

func newCapabilityTools(capabilities []ai.Capability) ([]einotool.BaseTool, error) {
	tools := make([]einotool.BaseTool, 0, len(capabilities))
	for _, capability := range capabilities {
		info, err := toolInfoFromCapability(capability)
		if err != nil {
			return nil, fmt.Errorf("能力 %s: %w", capability.Name, err)
		}
		parameters := capability.Parameters
		if parameters == nil {
			parameters = map[string]any{"type": "object"}
		}
		raw, err := json.Marshal(parameters)
		if err != nil {
			return nil, err
		}
		var document any
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, err
		}
		compiler := jsonschema.NewCompiler()
		compiler.AssertFormat()
		if err := compiler.AddResource("capability.json", document); err != nil {
			return nil, err
		}
		validator, err := compiler.Compile("capability.json")
		if err != nil {
			return nil, fmt.Errorf("能力 %s 的参数 Schema 无效: %w", capability.Name, err)
		}
		tools = append(tools, &capabilityTool{capability: capability, info: info, validator: validator})
	}
	return tools, nil
}

func (t *capabilityTool) Info(context.Context) (*einoschema.ToolInfo, error) {
	return t.info, nil
}

func (t *capabilityTool) InvokableRun(ctx context.Context, arguments string,
	_ ...einotool.Option) (string, error) {

	state, err := stateFromContext(ctx)
	if err != nil {
		return "", err
	}
	seq, ok := state.claimToolCall()
	if !ok {
		return "", errToolBudgetExceeded
	}

	record := ai.ToolCallRecord{
		Seq: seq, Name: t.capability.Name, Risk: t.capability.Risk, Arguments: arguments,
	}
	started := time.Now()
	fail := func(code, message string) (string, error) {
		record.Status = "denied"
		record.ErrorCode = code
		record.DurationMS = int(time.Since(started).Milliseconds())
		state.appendRecord(record, nil)
		return message, nil
	}

	if state.req.Sink != nil {
		state.req.Sink.OnToolCall(capabilityLabel(t.capability))
	}

	var args map[string]any
	if strings.TrimSpace(arguments) != "" {
		if err := json.Unmarshal([]byte(arguments), &args); err != nil {
			return fail("AI_TOOL_INPUT_INVALID", "参数不是合法 JSON，请检查后重试。")
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	if err := t.validator.Validate(args); err != nil {
		return fail("AI_TOOL_INPUT_INVALID", "参数不符合工具 Schema：请检查必填字段、类型、枚举与数组数量，修正后再调用。")
	}

	if state.seen(callFingerprint(t.capability.Name, args)) {
		return fail("AI_TOOL_LOOP_LIMIT", "这个查询刚刚已经执行过，结果没有变化。")
	}

	callCtx, cancel := context.WithTimeout(ctx, t.capability.Timeout)
	defer cancel()
	output, callErr := t.capability.Handler(callCtx, state.req.Ctx, args)
	record.DurationMS = int(time.Since(started).Milliseconds())
	if callErr != nil {
		var inputErr *ai.ToolInputError
		if errors.As(callErr, &inputErr) {
			return fail("AI_TOOL_INPUT_INVALID", inputErr.Message)
		}
		record.Status = "failed"
		record.ErrorCode = "AI_TOOL_FAILED"
		state.appendRecord(record, nil)
		state.logger.Warn("能力执行失败",
			"turn_id", state.req.TurnID, "capability", t.capability.Name, "error", callErr)
		return "查询失败，请基于已有信息回答，不要编造。", nil
	}
	state.mu.Lock()
	trusted := make(map[string]bool, len(state.trustedSources)+1)
	for ref := range state.trustedSources {
		trusted[ref] = true
	}
	if state.req.UserMessageID != "" {
		trusted["message:"+state.req.UserMessageID] = true
	}
	state.mu.Unlock()
	for _, draft := range output.Proposals {
		if t.capability.Risk != ai.RiskProposal || !ai.ProposalSourcesValid(draft, trusted) {
			return fail("AI_SOURCE_INVALID", "建议来源无效。创建类建议请引用本轮正式消息来源；修改类建议必须先读取目标，并引用工具实际返回的来源。")
		}
	}

	content := output.Content
	if len(content) > t.capability.MaxResultBytes {
		content = content[:t.capability.MaxResultBytes] + "\n（结果过长已截断）"
	}
	record.Status = "succeeded"
	record.Summary = summarize(content)
	record.SourceRefs = output.SourceRefs
	state.appendRecord(record, output.Proposals)
	return content, nil
}

func toolInfoFromCapability(capability ai.Capability) (*einoschema.ToolInfo, error) {
	info := &einoschema.ToolInfo{Name: capability.Name, Desc: capability.Description}
	if capability.Parameters == nil {
		return info, nil
	}
	raw, err := json.Marshal(capability.Parameters)
	if err != nil {
		return nil, err
	}
	var schema einojsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, err
	}
	info.ParamsOneOf = einoschema.NewParamsOneOfByJSONSchema(&schema)
	return info, nil
}

func toolSpecsFromEino(infos []*einoschema.ToolInfo) ([]ai.ToolSpec, error) {
	specs := make([]ai.ToolSpec, 0, len(infos))
	for _, info := range infos {
		if info == nil {
			continue
		}
		var parameters map[string]any
		if info.ParamsOneOf != nil {
			schema, err := info.ParamsOneOf.ToJSONSchema()
			if err != nil {
				return nil, fmt.Errorf("工具 %s 的参数 Schema 无效: %w", info.Name, err)
			}
			raw, err := json.Marshal(schema)
			if err != nil {
				return nil, err
			}
			if err := json.Unmarshal(raw, &parameters); err != nil {
				return nil, err
			}
		}
		specs = append(specs, ai.ToolSpec{
			Name: info.Name, Description: info.Desc, Parameters: parameters,
		})
	}
	return specs, nil
}

func buildMessages(req ai.TurnRequest) []*einoschema.Message {
	messages := make([]*einoschema.Message, 0, len(req.History)+3)
	messages = append(messages, einoschema.SystemMessage(req.SystemPrompt))
	if req.UserMessageID != "" {
		messages = append(messages, einoschema.SystemMessage("本轮用户输入的正式来源是 message:"+req.UserMessageID+"。用户要求新建内容或记住偏好时可引用它；禁止使用 current、时间戳或编造的 ID 代替来源。"))
	}
	if len(req.ContextBlocks) > 0 {
		var builder strings.Builder
		builder.WriteString("以下是这位用户已确认的事实与偏好，供你参考：\n")
		for _, block := range req.ContextBlocks {
			builder.WriteString("\n" + block + "\n")
		}
		messages = append(messages, einoschema.SystemMessage(builder.String()))
	}
	for _, message := range req.History {
		messages = append(messages, messageToEino(message))
	}
	messages = append(messages, einoschema.UserMessage(req.UserText))
	return messages
}

func messageToEino(message ai.Message) *einoschema.Message {
	switch message.Role {
	case ai.RoleSystem:
		return einoschema.SystemMessage(message.Content)
	case ai.RoleUser:
		return einoschema.UserMessage(message.Content)
	case ai.RoleTool:
		return einoschema.ToolMessage(message.Content, message.ToolCallID)
	default:
		return einoschema.AssistantMessage(message.Content, toolCallsToEino(message.ToolCalls))
	}
}

func messagesFromEino(messages []*einoschema.Message) []ai.Message {
	out := make([]ai.Message, 0, len(messages))
	for _, message := range messages {
		if message == nil {
			continue
		}
		converted := ai.Message{
			Role: ai.Role(message.Role), Content: message.Content, ToolCallID: message.ToolCallID,
		}
		for _, call := range message.ToolCalls {
			converted.ToolCalls = append(converted.ToolCalls, ai.ToolCall{
				ID: call.ID, Name: call.Function.Name, Arguments: call.Function.Arguments,
			})
		}
		out = append(out, converted)
	}
	return out
}

func toolCallsToEino(calls []ai.ToolCall) []einoschema.ToolCall {
	out := make([]einoschema.ToolCall, 0, len(calls))
	for _, call := range calls {
		out = append(out, einoschema.ToolCall{
			ID: call.ID, Type: "function",
			Function: einoschema.FunctionCall{Name: call.Name, Arguments: call.Arguments},
		})
	}
	return out
}

func callFingerprint(name string, args map[string]any) string {
	raw, err := json.Marshal(args)
	if err != nil {
		return name + ":" + fmt.Sprint(args)
	}
	sum := sha256.Sum256(append([]byte(name+":"), raw...))
	return string(sum[:])
}

func capabilityLabel(capability ai.Capability) string {
	switch capability.Name {
	case "tasks.search":
		return "正在查你的任务"
	case "calendar.read":
		return "正在看你的日程"
	case "objects.get":
		return "正在读这条内容"
	case "records.aggregate":
		return "正在统计你的记录"
	case "search.hybrid":
		return "正在搜索你的内容"
	case "reviews.read":
		return "正在看这周的数据"
	case "memories.search":
		return "正在回忆你的偏好"
	default:
		if capability.Risk == ai.RiskProposal {
			return "正在准备一条建议"
		}
		return "正在查资料"
	}
}

func summarize(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= 120 {
		return string(runes)
	}
	return string(runes[:120]) + "…"
}
