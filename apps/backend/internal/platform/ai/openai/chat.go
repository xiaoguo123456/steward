package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	if len(req.Tools) > 0 {
		body.Tools = toWireTools(req.Tools)
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
			InputTokens:  parsed.Usage.PromptTokens,
			OutputTokens: parsed.Usage.CompletionTokens,
			LatencyMS:    int(time.Since(started).Milliseconds()),
		},
	}
	for _, call := range choice.Message.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, ai.ToolCall{
			ID:        call.ID,
			Name:      call.Function.Name,
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
			wire.ToolCalls = append(wire.ToolCalls, toolCallWire{
				ID:   call.ID,
				Type: "function",
				Function: toolCallFunction{
					Name:      call.Name,
					Arguments: call.Arguments,
				},
			})
		}
		out = append(out, wire)
	}
	return out
}

func toWireTools(tools []ai.ToolSpec) []toolSpecWire {
	out := make([]toolSpecWire, 0, len(tools))
	for _, t := range tools {
		out = append(out, toolSpecWire{
			Type: "function",
			Function: toolFunctionSpec{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		})
	}
	return out
}
