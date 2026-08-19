package openai

import (
	"bufio"
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

// 流式补全。实现 ai.StreamingChatProvider。
//
// 协议是标准的 SSE：每行 `data: {...}`，最后一条是 `data: [DONE]`。
// 工具调用的参数会分多个 chunk 到达，必须按 index 累积后再解析。

type streamDelta struct {
	Content   string `json:"content"`
	ToolCalls []struct {
		Index    int    `json:"index"`
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}

type streamChunk struct {
	Choices []struct {
		Delta        streamDelta `json:"delta"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// CompleteStream 发起一次流式补全，边收边把文本增量交给 onDelta。
//
// 返回值与 Complete 完全一致：编排引擎不需要知道这一轮是不是流式的。
func (p *Provider) CompleteStream(ctx context.Context, req ai.CompletionRequest,
	onDelta func(string)) (ai.CompletionResult, error) {

	started := time.Now()

	maxTokens := req.MaxOutputTokens
	if maxTokens <= 0 {
		maxTokens = p.cfg.MaxOutputTokens
	}
	body := toolChatRequest{
		Model:               p.cfg.ChatModel,
		Messages:            toWireMessages(req.Messages),
		Temperature:         0.3,
		MaxCompletionTokens: maxTokens,
		Stream:              true,
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
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := p.streamClient.Do(httpReq)
	if err != nil {
		return ai.CompletionResult{}, fmt.Errorf("%w: %v", ai.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return ai.CompletionResult{}, ai.ErrRateLimited
	}
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		p.logger.Error("流式对话返回错误",
			"status", resp.StatusCode, "model", p.cfg.ChatModel,
			"body", truncate(string(raw), 500))
		return ai.CompletionResult{}, fmt.Errorf("%w: HTTP %d", ai.ErrProviderUnavailable, resp.StatusCode)
	}

	return p.readStream(resp.Body, onDelta, started)
}

// readStream 消费 SSE 响应体，拼出完整结果。
func (p *Provider) readStream(body io.Reader, onDelta func(string),
	started time.Time) (ai.CompletionResult, error) {

	var (
		content      strings.Builder
		finishReason string
		usage        ai.Usage
	)
	// 工具调用按 index 累积：参数是一个字符一个字符流过来的。
	calls := map[int]*ai.ToolCall{}
	var order []int

	scanner := bufio.NewScanner(body)
	// 单个 chunk 可能很长（尤其是工具参数），默认 64KB 缓冲不够。
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			// 单个 chunk 解析失败不该让整轮作废，跳过继续读。
			continue
		}
		if chunk.Error != nil {
			p.logger.Error("流式对话返回业务错误",
				"message", chunk.Error.Message, "type", chunk.Error.Type)
			return ai.CompletionResult{}, fmt.Errorf("%w: %s",
				ai.ErrProviderUnavailable, chunk.Error.Type)
		}
		if chunk.Usage != nil {
			usage.InputTokens = chunk.Usage.PromptTokens
			usage.OutputTokens = chunk.Usage.CompletionTokens
		}
		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		if choice.FinishReason != "" {
			finishReason = choice.FinishReason
		}
		if choice.Delta.Content != "" {
			content.WriteString(choice.Delta.Content)
			if onDelta != nil {
				onDelta(choice.Delta.Content)
			}
		}
		for _, call := range choice.Delta.ToolCalls {
			existing, ok := calls[call.Index]
			if !ok {
				existing = &ai.ToolCall{}
				calls[call.Index] = existing
				order = append(order, call.Index)
			}
			if call.ID != "" {
				existing.ID = call.ID
			}
			if call.Function.Name != "" {
				existing.Name = call.Function.Name
			}
			existing.Arguments += call.Function.Arguments
		}
	}
	if err := scanner.Err(); err != nil {
		return ai.CompletionResult{}, fmt.Errorf("%w: 读取流失败：%v", ai.ErrProviderUnavailable, err)
	}

	result := ai.CompletionResult{
		Content:      content.String(),
		FinishReason: finishReason,
		Usage: ai.Usage{
			InputTokens:  usage.InputTokens,
			OutputTokens: usage.OutputTokens,
			LatencyMS:    int(time.Since(started).Milliseconds()),
		},
	}
	for _, index := range order {
		result.ToolCalls = append(result.ToolCalls, *calls[index])
	}
	return result, nil
}
