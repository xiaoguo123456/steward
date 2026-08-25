// Package assets 以 embed 方式携带 AI Prompt 与 JSON Schema。
//
// prompts/ 与 schemas/ 是 packages/ai-contracts 的副本，
// 由 scripts/sync-ai-contracts.sh 生成，禁止手工修改。
package assets

import (
	_ "embed"
)

// CaptureParsePromptV1 是 Capture 结构化解析的系统提示词。
//
//go:embed prompts/capture-parse/v1.md
var CaptureParsePromptV1 string

// VisionExtractPromptV1 是图片信息提取的系统提示词。
//
//go:embed prompts/vision-extract/v1.md
var VisionExtractPromptV1 string

// AssistantPolicyV1 是通用 Assistant 的 System Policy。
//
//go:embed prompts/assistant/v1.md
var AssistantPolicyV1 string

// ReviewNarrativePromptV2 是复盘结构化内容的系统提示词。
//
//go:embed prompts/review-narrative/v2.md
var ReviewNarrativePromptV2 string

// CaptureParseSchemaV1 是解析结果的完整 JSON Schema。
//
// 模型返回的原始 JSON 属于不可信输入，必须先通过它再进入 Domain 校验。
//
//go:embed schemas/capture/capture-parse-result.v1.schema.json
var CaptureParseSchemaV1 []byte

// ReviewNarrativeSchemaV2 是周复盘模型输出的完整 JSON Schema。
//
//go:embed schemas/review/review-narrative-result.v2.schema.json
var ReviewNarrativeSchemaV2 []byte

// 版本号随 Prompt 与 Schema 变化递增，写入 AI Action 审计记录。
const (
	CaptureParsePromptVersion    = "capture-parse@v1"
	VisionExtractPromptVersion   = "vision-extract@v1"
	AssistantPolicyVersion       = "assistant@v1"
	ReviewNarrativePromptVersion = "review-narrative@v2"
	ReviewNarrativeSchemaVersion = "review-narrative-result.v2"
	CaptureParseSchemaVersion    = "capture-parse-result.v1"
)
