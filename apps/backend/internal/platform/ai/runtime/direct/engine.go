// Package direct 是第一阶段的编排引擎实现。
//
// 它使用官方 Provider 协议加一个薄工具循环，不引入任何编排框架。
// 薄编排层只负责六件事：组装上下文、计算允许集合、调用模型、
// 处理受控工具循环、校验输出与来源、返回中立结果。
//
// 领域判断、数据库查询、修改命令、时间规则与重复检测都不在这里。
package direct

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// Engine 实现 ai.OrchestrationEngine。
type Engine struct {
	provider ai.ChatProvider
	logger   *slog.Logger
}

// New 构造 Engine。
func New(provider ai.ChatProvider, logger *slog.Logger) *Engine {
	if logger == nil {
		logger = slog.Default()
	}
	return &Engine{provider: provider, logger: logger}
}

// Version 返回引擎版本，写入 Turn 审计。
func (e *Engine) Version() string { return "direct@v1" }

// RunTurn 执行一次对话轮次。
func (e *Engine) RunTurn(ctx context.Context, req ai.TurnRequest) (ai.TurnResult, error) {
	limits := req.Limits
	if limits.MaxToolRounds <= 0 {
		limits = ai.DefaultRunLimits()
	}

	deadline := time.Now().Add(limits.MaxDuration)
	runCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	messages := e.buildMessages(req)
	tools := toolSpecs(req.Capabilities)
	byName := make(map[string]ai.Capability, len(req.Capabilities))
	for _, c := range req.Capabilities {
		byName[c.Name] = c
	}

	var result ai.TurnResult
	// seenCalls 记录已执行过的「工具 + 规范化参数」，用于识别重复调用。
	seenCalls := make(map[string]bool)
	totalCalls := 0

	for round := 0; ; round++ {
		// 停止条件：轮数上限。
		if round >= limits.MaxToolRounds {
			e.logger.Warn("达到工具轮数上限，给出降级回答",
				"turn_id", req.TurnID, "rounds", round)
			result.Degraded = true
			break
		}
		// 停止条件：用户已取消或整体超时。
		if err := runCtx.Err(); err != nil {
			if errors.Is(err, context.Canceled) {
				return ai.TurnResult{}, ai.ErrTurnCancelled
			}
			result.Degraded = true
			break
		}
		// 停止条件：token 预算。
		if limits.MaxTokens > 0 &&
			result.Usage.InputTokens+result.Usage.OutputTokens >= limits.MaxTokens {
			e.logger.Warn("达到 token 上限，给出降级回答", "turn_id", req.TurnID)
			result.Degraded = true
			break
		}

		completion, err := e.complete(runCtx, ai.CompletionRequest{
			Messages: messages,
			Tools:    tools,
		}, req.Sink)
		if err != nil {
			// 已经拿到过工具结果时，用已有证据给降级回答；否则整体失败。
			if len(result.ToolCalls) > 0 {
				result.Degraded = true
				break
			}
			return ai.TurnResult{}, err
		}

		result.Usage.InputTokens += completion.Usage.InputTokens
		result.Usage.OutputTokens += completion.Usage.OutputTokens
		result.Usage.LatencyMS += completion.Usage.LatencyMS

		// 停止条件：模型给出了最终回答。
		if len(completion.ToolCalls) == 0 {
			result.Text = strings.TrimSpace(completion.Content)
			break
		}

		messages = append(messages, ai.Message{
			Role:      ai.RoleAssistant,
			Content:   completion.Content,
			ToolCalls: completion.ToolCalls,
		})

		for _, call := range completion.ToolCalls {
			// 停止条件：调用次数上限。
			if totalCalls >= limits.MaxToolCalls {
				result.Degraded = true
				break
			}
			totalCalls++

			record, toolMessage := e.executeCall(runCtx, req, byName, call, seenCalls, totalCalls)
			result.ToolCalls = append(result.ToolCalls, record.ToolCallRecord)
			messages = append(messages, toolMessage)

			if record.Status == "succeeded" && len(record.proposals) > 0 {
				result.Proposals = append(result.Proposals, record.proposals...)
			}
		}
		if result.Degraded {
			break
		}
	}

	if result.Text == "" {
		// 降级时明说这是不完整的回答，不假装已经查全。
		result.Text = "我这次没能把信息查全，先把已经确认的部分告诉你。如果需要，可以再问我一次。"
		result.Degraded = true
	}
	return result, nil
}

// complete 调用模型。
//
// Provider 支持流式时逐段推给 Sink，让用户马上看到字在动；
// 不支持就退回一次性返回，行为完全一致，只是等得久一点。
func (e *Engine) complete(ctx context.Context, req ai.CompletionRequest,
	sink ai.TurnSink) (ai.CompletionResult, error) {

	streaming, ok := e.provider.(ai.StreamingChatProvider)
	if !ok || sink == nil {
		return e.provider.Complete(ctx, req)
	}
	return streaming.CompleteStream(ctx, req, sink.OnDelta)
}

// callRecord 在审计记录基础上带上本次产生的建议。
type callRecord struct {
	ai.ToolCallRecord
	proposals []ai.ProposalDraft
}

// executeCall 执行一次工具调用，并返回审计记录与交回模型的消息。
//
// 每次调用都重新授权：模型收到的工具列表只是提示，不是许可。
func (e *Engine) executeCall(ctx context.Context, req ai.TurnRequest,
	byName map[string]ai.Capability, call ai.ToolCall,
	seenCalls map[string]bool, seq int) (callRecord, ai.Message) {

	record := callRecord{}
	record.Seq = seq
	record.Name = call.Name
	record.Arguments = call.Arguments
	started := time.Now()

	fail := func(code, message string) (callRecord, ai.Message) {
		record.Status = "denied"
		record.ErrorCode = code
		record.DurationMS = int(time.Since(started).Milliseconds())
		return record, ai.Message{
			Role: ai.RoleTool, ToolCallID: call.ID, Content: message,
		}
	}

	if req.Sink != nil {
		if capability, ok := byName[call.Name]; ok {
			req.Sink.OnToolCall(capabilityLabel(capability))
		}
	}

	capability, ok := byName[call.Name]
	if !ok {
		// 停止条件之一：模型请求了未授权工具。这里拒绝并告知，不中断整轮。
		e.logger.Warn("模型请求了未授权的能力",
			"turn_id", req.TurnID, "capability", call.Name)
		return fail("AI_TOOL_NOT_ALLOWED", "这个能力不可用，请改用其他方式回答。")
	}
	record.Risk = capability.Risk

	var args map[string]any
	if strings.TrimSpace(call.Arguments) != "" {
		if err := json.Unmarshal([]byte(call.Arguments), &args); err != nil {
			return fail("AI_TOOL_INPUT_INVALID", "参数不是合法 JSON，请检查后重试。")
		}
	}
	if args == nil {
		args = map[string]any{}
	}

	// 停止条件之一：同一工具与规范化参数重复调用。
	fingerprint := callFingerprint(call.Name, args)
	if seenCalls[fingerprint] {
		return fail("AI_TOOL_LOOP_LIMIT", "这个查询刚刚已经执行过，结果没有变化。")
	}
	seenCalls[fingerprint] = true

	callCtx, cancel := context.WithTimeout(ctx, capability.Timeout)
	defer cancel()

	out, err := capability.Handler(callCtx, req.Ctx, args)
	record.DurationMS = int(time.Since(started).Milliseconds())
	if err != nil {
		e.logger.Warn("能力执行失败",
			"turn_id", req.TurnID, "capability", call.Name, "error", err)
		record.Status = "failed"
		record.ErrorCode = "AI_TOOL_FAILED"
		return record, ai.Message{
			Role: ai.RoleTool, ToolCallID: call.ID,
			Content: "查询失败，请基于已有信息回答，不要编造。",
		}
	}

	content := out.Content
	if len(content) > capability.MaxResultBytes {
		// 超限时截断而不是整体失败，同时告诉模型结果不完整。
		content = content[:capability.MaxResultBytes] + "\n（结果过长已截断）"
	}

	record.Status = "succeeded"
	record.Summary = summarize(content)
	record.SourceRefs = out.SourceRefs
	record.proposals = out.Proposals

	return record, ai.Message{Role: ai.RoleTool, ToolCallID: call.ID, Content: content}
}

// buildMessages 按固定区块组装 Prompt。
//
// System Policy 与用户资料使用不同角色；已确认事实单独成块，
// 让模型能区分“系统规则”“已知事实”和“用户这次说的话”。
func (e *Engine) buildMessages(req ai.TurnRequest) []ai.Message {
	messages := make([]ai.Message, 0, len(req.History)+3)
	messages = append(messages, ai.Message{Role: ai.RoleSystem, Content: req.SystemPrompt})

	if len(req.ContextBlocks) > 0 {
		var b strings.Builder
		b.WriteString("以下是这位用户已确认的事实与偏好，供你参考：\n")
		for _, block := range req.ContextBlocks {
			b.WriteString("\n" + block + "\n")
		}
		messages = append(messages, ai.Message{Role: ai.RoleSystem, Content: b.String()})
	}

	messages = append(messages, req.History...)
	messages = append(messages, ai.Message{Role: ai.RoleUser, Content: req.UserText})
	return messages
}

func toolSpecs(capabilities []ai.Capability) []ai.ToolSpec {
	out := make([]ai.ToolSpec, 0, len(capabilities))
	for _, c := range capabilities {
		out = append(out, ai.ToolSpec{
			Name:        c.Name,
			Description: c.Description,
			Parameters:  c.Parameters,
		})
	}
	return out
}

// callFingerprint 计算「工具 + 规范化参数」的指纹。
// 用 JSON 序列化保证键序稳定，从而识别语义相同的重复调用。
func callFingerprint(name string, args map[string]any) string {
	raw, err := json.Marshal(args)
	if err != nil {
		return name + ":" + fmt.Sprint(args)
	}
	sum := sha256.Sum256(append([]byte(name+":"), raw...))
	return string(sum[:])
}

// capabilityLabel 把能力名转成给用户看的一句话。
//
// 界面上不出现工具名与参数：用户关心的是"在查什么"，
// 而 tasks.search 这种内部标识对他没有意义。
func capabilityLabel(c ai.Capability) string {
	switch c.Name {
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
		if c.Risk == ai.RiskProposal {
			return "正在准备一条建议"
		}
		return "正在查资料"
	}
}

// summarize 生成不含完整正文的结果摘要，用于审计。
func summarize(content string) string {
	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= 120 {
		return string(runes)
	}
	return string(runes[:120]) + "…"
}
