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

	Timeout         time.Duration
	MaxOutputTokens int

	// Fallback 在 Provider 不可用时接管解析，保证功能降级而不是整体失败。
	Fallback ai.CaptureParser
	Logger   *slog.Logger
}

// Provider 实现 ai.CaptureParser 与 ai.MediaProcessor。
type Provider struct {
	cfg    Config
	client *http.Client
	logger *slog.Logger
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
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	return &Provider{
		cfg: cfg,
		// 单次调用超时由 Config.Timeout 控制；这里再留一点余量给连接建立。
		client: &http.Client{Timeout: cfg.Timeout + 10*time.Second},
		logger: cfg.Logger,
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
		// 不把服务商的原始错误正文透出给用户，只记录到服务端日志。
		p.logger.Error("模型服务返回错误",
			"status", resp.StatusCode, "model", model,
			"body", truncate(string(raw), 500))
		return "", ai.Usage{}, fmt.Errorf("%w: HTTP %d", ai.ErrProviderUnavailable, resp.StatusCode)
	}

	var parsed chatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", ai.Usage{}, fmt.Errorf("%w: 响应不是合法 JSON", ai.ErrProviderUnavailable)
	}
	if parsed.Error != nil {
		p.logger.Error("模型服务返回业务错误", "message", parsed.Error.Message, "type", parsed.Error.Type)
		return "", ai.Usage{}, fmt.Errorf("%w: %s", ai.ErrProviderUnavailable, parsed.Error.Type)
	}
	if len(parsed.Choices) == 0 {
		return "", ai.Usage{}, fmt.Errorf("%w: 响应没有内容", ai.ErrProviderUnavailable)
	}

	usage := ai.Usage{
		InputTokens:  parsed.Usage.PromptTokens,
		OutputTokens: parsed.Usage.CompletionTokens,
		LatencyMS:    int(time.Since(started).Milliseconds()),
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
			"status", resp.StatusCode, "body", truncate(string(raw), 300))
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
