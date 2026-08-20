package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// 本文件实现 ai.ChatProvider：带工具调用的通用补全。
//
// 与 client.go 里的 chat 不同，这里需要把工具规格发出去、把工具结果发回去，
// 因此使用一套更完整的协议类型。两者共用同一个 HTTP 客户端与错误分类规则。

type toolFunctionSpec struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type toolSpecWire struct {
	Type     string           `json:"type"`
	Function toolFunctionSpec `json:"function"`
}

type toolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type toolCallWire struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function toolCallFunction `json:"function"`
}

// toolChatMessage 相比 chatMessage 多了工具调用相关字段。
type toolChatMessage struct {
	Role       string         `json:"role"`
	Content    string         `json:"content"`
	ToolCalls  []toolCallWire `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

type toolChatRequest struct {
	Model               string            `json:"model"`
	Messages            []toolChatMessage `json:"messages"`
	Tools               []toolSpecWire    `json:"tools,omitempty"`
	ToolChoice          string            `json:"tool_choice,omitempty"`
	Temperature         float64           `json:"temperature"`
	MaxCompletionTokens int               `json:"max_completion_tokens,omitempty"`
	Stream              bool              `json:"stream,omitempty"`
	// StreamOptions 只在流式时带上。
	StreamOptions *streamOptions `json:"stream_options,omitempty"`
}

// streamOptions 里目前只有一件事：让服务端在流末尾补一个用量帧。
//
// **流式响应默认不返回 token 用量**，不显式要就永远是 0——
// 而 Assistant 每一轮都是流式的，等于最贵的那条链路完全没有用量数据。
// 这个坑同样只有真连模型才看得见：审计表里延迟有值、token 是 0。
type streamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type toolChatResponse struct {
	Choices []struct {
		Message struct {
			Content   string         `json:"content"`
			ToolCalls []toolCallWire `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		// 命中缓存的输入 token。多数服务商对它另有折扣价，
		// 不单独取出来就会按全价算，成本报表会偏高。
		PromptTokensDetails struct {
			CachedTokens int `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// ModelName 返回对话使用的模型名，写入 Turn 审计。
func (p *Provider) ModelName() string { return p.cfg.ChatModel }

// Complete 实现 ai.ChatProvider。
//
// 它只做协议转换与错误分类：是否执行模型申请的工具、是否允许，
// 全部由编排引擎决定。这里发出去的工具列表只是提示。
func (p *Provider) Complete(ctx context.Context, req ai.CompletionRequest) (ai.CompletionResult, error) {
	started := time.Now()

	maxTokens := req.MaxOutputTokens
	if maxTokens <= 0 {
		maxTokens = p.cfg.MaxOutputTokens
	}

	body := toolChatRequest{
		Model:    p.cfg.ChatModel,
		Messages: toWireMessages(req.Messages),
		// 对话需要自然一点，但仍偏保守，避免自由发挥出不存在的事实。
		Temperature:         0.3,
		MaxCompletionTokens: maxTokens,
	}
	toolNames := map[string]string{}
	if len(req.Tools) > 0 {
		body.Tools, toolNames = toWireTools(req.Tools)
		body.ToolChoice = "auto"
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return ai.CompletionResult{}, err
	}

	callCtx, cancel := context.WithTimeout(ctx, p.cfg.Timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(callCtx, http.MethodPost,
		p.cfg.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return ai.CompletionResult{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return ai.CompletionResult{}, fmt.Errorf("%w: %v", ai.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ai.CompletionResult{}, fmt.Errorf("%w: 读取响应失败", ai.ErrProviderUnavailable)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return ai.CompletionResult{}, ai.ErrRateLimited
	}
	if resp.StatusCode >= 400 {
		p.logger.Error("对话服务返回错误",
			"status", resp.StatusCode, "model", p.cfg.ChatModel,
			"body", truncate(string(raw), 500))
		return ai.CompletionResult{}, fmt.Errorf("%w: HTTP %d", ai.ErrProviderUnavailable, resp.StatusCode)
	}

	var parsed toolChatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ai.CompletionResult{}, fmt.Errorf("%w: 响应不是合法 JSON", ai.ErrProviderUnavailable)
	}
	if parsed.Error != nil {
		p.logger.Error("对话服务返回业务错误",
			"message", parsed.Error.Message, "type", parsed.Error.Type)
		return ai.CompletionResult{}, fmt.Errorf("%w: %s", ai.ErrProviderUnavailable, parsed.Error.Type)
	}
	if len(parsed.Choices) == 0 {
		return ai.CompletionResult{}, fmt.Errorf("%w: 响应没有内容", ai.ErrProviderUnavailable)
	}

	choice := parsed.Choices[0]
	result := ai.CompletionResult{
		Content:      choice.Message.Content,
		FinishReason: choice.FinishReason,
		Usage: ai.Usage{
			InputTokens:       parsed.Usage.PromptTokens,
			CachedInputTokens: parsed.Usage.PromptTokensDetails.CachedTokens,
			OutputTokens:      parsed.Usage.CompletionTokens,
			LatencyMS:         int(time.Since(started).Milliseconds()),
		},
	}
	for _, call := range choice.Message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, ai.ToolCall{
			ID: call.ID,
			// 还原成能力名，否则引擎会拿着 tasks_search 去授权表里
			// 找 tasks.search，一律拒绝。
			Name:      fromWireToolName(call.Function.Name, toolNames),
			Arguments: call.Function.Arguments,
		})
	}
	return result, nil
}

func toWireMessages(messages []ai.Message) []toolChatMessage {
	out := make([]toolChatMessage, 0, len(messages))
	for _, m := range messages {
		wire := toolChatMessage{
			Role:       string(m.Role),
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
		}
		for _, call := range m.ToolCalls {
			// 历史里的工具名也要转成线上名：模型看到的必须和它自己发出的一致。
			wire.ToolCalls = append(wire.ToolCalls, toolCallWire{
				ID:   call.ID,
				Type: "function",
				Function: toolCallFunction{
					Name:      toWireToolName(call.Name),
					Arguments: call.Arguments,
				},
			})
		}
		out = append(out, wire)
	}
	return out
}

func toWireTools(tools []ai.ToolSpec) ([]toolSpecWire, map[string]string) {
	out := make([]toolSpecWire, 0, len(tools))
	// 线上名 → 能力名。模型回传的工具名要按它还原。
	back := make(map[string]string, len(tools))
	for _, t := range tools {
		wire := toWireToolName(t.Name)
		back[wire] = t.Name
		out = append(out, toolSpecWire{
			Type: "function",
			Function: toolFunctionSpec{
				Name:        wire,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		})
	}
	return out, back
}

// toWireToolName 把能力名转成服务端接受的形式。
//
// 我们的能力名是 tasks.search 这种带点的；而服务端要求工具名匹配
// `^[a-zA-Z0-9_-]+$`，带点会被 400 打回：
//
//	Invalid 'tools[0].name': string does not match pattern
//
// **不能反过来把能力名改成 tasks_search**：那是让一家服务商的正则
// 渗进领域命名，而能力名还出现在评测用例、审计记录与文档里。
// 协议细节只留在本包内，这正是这个适配器存在的意义。
//
// 转换不追求可逆（tasks.propose_create 与 tasks_propose_create 撞在一起时
// 没法凭字符串反推），而是**每次调用建一张回映射表**——
// 工具清单本来就是我们自己给的，映射一定准确。
func toWireToolName(name string) string {
	return strings.NewReplacer(".", "_", "/", "_", ":", "_").Replace(name)
}

// fromWireToolName 把模型回传的工具名还原成能力名。
//
// 认不出来时原样返回：引擎会按名字重新授权，不在清单里的一律拒绝
// （AI_TOOL_NOT_ALLOWED）并留审计。**这里不要试图猜**——
// 猜错等于把一次越权调用翻译成一次合法调用。
func fromWireToolName(wire string, back map[string]string) string {
	if name, ok := back[wire]; ok {
		return name
	}
	return wire
}
