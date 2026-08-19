// Package openai 是 OpenAI 的 Provider Adapter。
//
// Provider SDK 只允许出现在 Adapter 内：业务模块永远只看到 ai 包里的中立接口，
// 因此更换 Provider 不需要改动任何业务代码。
//
// 当前实现是骨架：接入真实模型前，它把请求委托给注入的兜底解析器，
// 并在日志中说明原因，而不是让整条 Capture 链路失败。
// 正式接入需要先完成以下决策（见后端指南第 28 节）：
// 首选模型、数据处理区域与保留策略、单用户与全局预算上限。
package openai

import (
	"context"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// Provider 是 OpenAI Capture 解析适配器。
type Provider struct {
	apiKey  string
	baseURL string
	// fallback 在尚未接入真实模型时承担解析，保证功能不中断。
	fallback ai.CaptureParser
}

// New 构造 Provider。
func New(apiKey, baseURL string, fallback ai.CaptureParser) *Provider {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &Provider{apiKey: apiKey, baseURL: baseURL, fallback: fallback}
}

// Name 返回 Provider 名称。
func (p *Provider) Name() string { return "openai" }

// ParseCapture 解析一次 Capture 输入。
//
// 真实实现需要：
//  1. 用 schemacompiler 把项目完整 JSON Schema 编译成 Provider 支持的子集；
//  2. 调用 Responses API 并要求结构化输出；
//  3. 对返回的原始 JSON 再次执行完整 Schema、来源与 Domain 校验；
//  4. 结构无效时只允许一次“仅修复结构”的重试。
//
// 在这些步骤落地之前，这里不发起任何网络请求，也不伪造模型结果。
func (p *Provider) ParseCapture(ctx context.Context, req ai.CaptureParseRequest) (ai.CaptureParseResult, error) {
	if strings.TrimSpace(p.apiKey) == "" {
		return ai.CaptureParseResult{}, ai.ErrProviderUnavailable
	}
	result, err := p.fallback.ParseCapture(ctx, req)
	if err != nil {
		return ai.CaptureParseResult{}, err
	}
	// 明确标注结果并非来自真实模型，避免审计记录产生误导。
	result.ProviderModel = "openai-adapter-not-implemented"
	return result, nil
}
