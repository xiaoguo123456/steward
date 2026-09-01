// Package openai 是兼容 OpenAI 协议的 Provider 适配器。
//
// Provider SDK 与线上协议细节只允许出现在本包内：业务模块看到的始终是
// ai 包里的中立接口。因此更换服务商或模型不需要改动任何业务代码。
//
// 本包不读数据库、不决定业务状态，也不判断用户是否拥有某个资源。
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/assets"
)

// Config 是适配器配置。
type Config struct {
	// BaseURL 是兼容 OpenAI 协议的服务地址，不带结尾斜杠。
	BaseURL string
	APIKey  string

	// 各用途使用的模型。业务代码只引用用途，不引用具体模型名。
	ParseModel      string
	VisionModel     string
	TranscribeModel string
	ChatModel       string

	Timeout         time.Duration
	MaxOutputTokens int

	Logger *slog.Logger
}

// Provider 实现 ai.CaptureParser、ai.MediaProcessor 与 ai.StreamingChatProvider。
type Provider struct {
	cfg    Config
	client *http.Client
	// streamClient 不设整体超时：流式响应本来就要持续几十秒，
	// 用 client.Timeout 会在读到一半时把连接掐掉。超时由 context 控制。
	streamClient *http.Client
	logger       *slog.Logger
}

// New 构造适配器。
func New(cfg Config) (*Provider, error) {
	if cfg.BaseURL == "" {
		return nil, errors.New("必须配置模型服务地址")
	}
	if cfg.APIKey == "" {
		return nil, errors.New("必须配置模型服务密钥")
	}
	if cfg.ParseModel == "" {
		return nil, errors.New("必须配置解析模型")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 45 * time.Second
	}
	if cfg.MaxOutputTokens <= 0 {
		cfg.MaxOutputTokens = 2048
	}
	if cfg.VisionModel == "" {
		cfg.VisionModel = cfg.ParseModel
	}
	if cfg.ChatModel == "" {
		cfg.ChatModel = cfg.ParseModel
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	return &Provider{
		cfg: cfg,
		// 单次调用超时由 Config.Timeout 控制；这里再留一点余量给连接建立。
		client:       &http.Client{Timeout: cfg.Timeout + 10*time.Second},
		streamClient: &http.Client{},
		logger:       cfg.Logger,
	}, nil
}

// Name 返回 Provider 名称。
func (p *Provider) Name() string { return "openai-compatible" }

// ---- 线上协议类型。它们只存在于本包内，不向外泄漏。 ----

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type contentPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *imageURLPart `json:"image_url,omitempty"`
}

type imageURLPart struct {
	URL string `json:"url"`
}

type chatRequest struct {
	Model               string          `json:"model"`
	Messages            []chatMessage   `json:"messages"`
	Temperature         float64         `json:"temperature"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	ResponseFormat      *responseFormat `json:"response_format,omitempty"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
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

// chat 发起一次对话补全调用。
//
// 它只负责传输与错误分类，不解释业务语义。
func (p *Provider) chat(ctx context.Context, model string, messages []chatMessage, wantJSON bool) (string, ai.Usage, error) {
	started := time.Now()

	body := chatRequest{
		Model:    model,
		Messages: messages,
		// 结构化抽取要可复现，温度固定为 0。
		Temperature:         0,
		MaxCompletionTokens: p.cfg.MaxOutputTokens,
	}
	if wantJSON {
		body.ResponseFormat = &responseFormat{Type: "json_object"}
		body.Messages = ensureJSONMention(body.Messages)
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", ai.Usage{}, err
	}

	callCtx, cancel := context.WithTimeout(ctx, p.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(callCtx, http.MethodPost,
		p.cfg.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", ai.Usage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		// 网络层失败一律归为「暂时不可用」，让上层降级而不是把原始错误抛给用户。
		return "", ai.Usage{}, fmt.Errorf("%w: %v", ai.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", ai.Usage{}, fmt.Errorf("%w: 读取响应失败", ai.ErrProviderUnavailable)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return "", ai.Usage{}, ai.ErrRateLimited
	}
	if resp.StatusCode >= 400 {
		// Provider 原始正文可能回显用户输入或内部请求，不进入日志。
		p.logger.Error("模型服务返回错误",
			"status", resp.StatusCode, "model", model)
		return "", ai.Usage{}, fmt.Errorf("%w: HTTP %d", ai.ErrProviderUnavailable, resp.StatusCode)
	}

	var parsed chatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", ai.Usage{}, fmt.Errorf("%w: 响应不是合法 JSON", ai.ErrProviderUnavailable)
	}
	if parsed.Error != nil {
		p.logger.Error("模型服务返回业务错误", "type", parsed.Error.Type)
		return "", ai.Usage{}, fmt.Errorf("%w: %s", ai.ErrProviderUnavailable, parsed.Error.Type)
	}
	if len(parsed.Choices) == 0 {
		return "", ai.Usage{}, fmt.Errorf("%w: 响应没有内容", ai.ErrProviderUnavailable)
	}

	usage := ai.Usage{
		InputTokens:       parsed.Usage.PromptTokens,
		CachedInputTokens: parsed.Usage.PromptTokensDetails.CachedTokens,
		OutputTokens:      parsed.Usage.CompletionTokens,
		LatencyMS:         int(time.Since(started).Milliseconds()),
	}
	return parsed.Choices[0].Message.Content, usage, nil
}

// ExtractFromImage 识别图片中的文字与关键信息。
//
// 图片以 data URI 内联发送，而不是给模型一个可访问的地址：
// 一来本地开发时模型服务无法访问内网地址，二来避免签名 URL 外泄。
func (p *Provider) ExtractFromImage(ctx context.Context, input ai.MediaInput) (string, ai.Usage, error) {
	if len(input.Data) == 0 {
		return "", ai.Usage{}, errors.New("图片内容为空")
	}

	dataURI := "data:" + input.ContentType + ";base64," + encodeBase64(input.Data)
	messages := []chatMessage{
		{Role: "system", Content: assets.VisionExtractPromptV1},
		{Role: "user", Content: []contentPart{
			{Type: "text", Text: "请提取这张图片里的文字与关键信息。"},
			{Type: "image_url", ImageURL: &imageURLPart{URL: dataURI}},
		}},
	}

	text, usage, err := p.chat(ctx, p.cfg.VisionModel, messages, false)
	if err != nil {
		return "", usage, err
	}
	return strings.TrimSpace(text), usage, nil
}

// Transcribe 把音频转写为文字。
//
// 走标准的 /audio/transcriptions 接口。若服务商不提供该能力，
// 调用方应当把该输入项标记为失败并让用户改用文字，而不是伪造转写结果。
func (p *Provider) Transcribe(ctx context.Context, input ai.MediaInput) (string, ai.Usage, error) {
	if p.cfg.TranscribeModel == "" {
		return "", ai.Usage{}, fmt.Errorf("%w: 未配置转写模型", ai.ErrProviderUnavailable)
	}

	started := time.Now()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	part, err := writer.CreateFormFile("file", "audio"+extensionFor(input.ContentType))
	if err != nil {
		return "", ai.Usage{}, err
	}
	if _, err := part.Write(input.Data); err != nil {
		return "", ai.Usage{}, err
	}
	if err := writer.WriteField("model", p.cfg.TranscribeModel); err != nil {
		return "", ai.Usage{}, err
	}
	// 明确指定中文，避免短音频被识别成其他语言。
	if err := writer.WriteField("language", "zh"); err != nil {
		return "", ai.Usage{}, err
	}
	if err := writer.Close(); err != nil {
		return "", ai.Usage{}, err
	}

	callCtx, cancel := context.WithTimeout(ctx, p.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(callCtx, http.MethodPost,
		p.cfg.BaseURL+"/audio/transcriptions", &buf)
	if err != nil {
		return "", ai.Usage{}, err
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := p.client.Do(req)
	if err != nil {
		return "", ai.Usage{}, fmt.Errorf("%w: %v", ai.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		p.logger.Error("转写服务返回错误",
			"status", resp.StatusCode)
		return "", ai.Usage{}, fmt.Errorf("%w: HTTP %d", ai.ErrProviderUnavailable, resp.StatusCode)
	}

	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", ai.Usage{}, fmt.Errorf("%w: 转写响应不是合法 JSON", ai.ErrProviderUnavailable)
	}

	usage := ai.Usage{LatencyMS: int(time.Since(started).Milliseconds())}
	return strings.TrimSpace(parsed.Text), usage, nil
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}

func extensionFor(contentType string) string {
	switch {
	case strings.Contains(contentType, "wav"):
		return ".wav"
	case strings.Contains(contentType, "webm"):
		return ".webm"
	case strings.Contains(contentType, "mpeg"), strings.Contains(contentType, "mp3"):
		return ".mp3"
	default:
		return ".m4a"
	}
}

// ensureJSONMention 保证**用户消息**里出现 "json" 这个词。
//
// 用 response_format=json_object 时服务端要求消息里必须字面提到 json，
// 否则整个请求以 400 打回：
//
//	Response input messages must contain the word 'json' in some form
//	to use 'text.format' of type 'json_object'
//
// **只补在 user 上，补在 system 上没用。** 报错文案里的
// 「Response input messages」与「text.format」是 Responses API 的说法，
// 说明服务商把 chat/completions 转译成了 Responses API；转译时 system
// 变成了 instructions，不算 input message，因此系统提示词里写多少个 json
// 都不算数。我们的解析提示词本来就提到 json 三次，照样被拒。
//
// **这类问题脚本化 Provider 永远测不出来**：它不校验请求体，
// 只有真连一次模型服务才会暴露。
func ensureJSONMention(messages []chatMessage) []chatMessage {
	for _, m := range messages {
		if m.Role != "user" {
			continue
		}
		if strings.Contains(strings.ToLower(textOf(m.Content)), "json") {
			return messages
		}
	}

	const hint = "\n\n（以 JSON 格式输出／output must be valid json）"
	out := make([]chatMessage, len(messages))
	copy(out, messages)
	// 补在最后一条纯文本 user 上。多段内容（带图的那种）不动：
	// 往里塞一段文本会打乱 text 与 image_url 的配对。
	for i := len(out) - 1; i >= 0; i-- {
		if out[i].Role != "user" {
			continue
		}
		if existing, ok := out[i].Content.(string); ok {
			out[i].Content = existing + hint
			return out
		}
	}
	return append(out, chatMessage{Role: "user", Content: strings.TrimSpace(hint)})
}

// textOf 取出消息里的文字部分。多段内容只看 text 段，图片忽略。
func textOf(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []contentPart:
		var b strings.Builder
		for _, part := range v {
			b.WriteString(part.Text)
			b.WriteString(" ")
		}
		return b.String()
	default:
		return ""
	}
}
