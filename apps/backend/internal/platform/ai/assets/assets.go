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

// CaptureParsePromptV2 增加行程项目的结构化抽取规则。
//
//go:embed prompts/capture-parse/v2.md
var CaptureParsePromptV2 string

// CaptureParsePromptV3 增加行程交通、住宿、活动与票据抽取规则。
//
//go:embed prompts/capture-parse/v3.md
var CaptureParsePromptV3 string

// CaptureParsePromptV4 增加更新目标、重复检测与候选关系引用规则。
//
//go:embed prompts/capture-parse/v4.md
var CaptureParsePromptV4 string

// CaptureParsePromptV5 明确按时间正序处理澄清问答，禁止把回答当成独立事项。
//
//go:embed prompts/capture-parse/v5.md
var CaptureParsePromptV5 string

// VisionExtractPromptV1 是图片信息提取的系统提示词。
//
//go:embed prompts/vision-extract/v1.md
var VisionExtractPromptV1 string

// AssistantPolicyV1 是通用 Assistant 的 System Policy。
//
//go:embed prompts/assistant/v3.md
var AssistantPolicyV1 string

// ReviewNarrativePromptV2 是复盘结构化内容的系统提示词。
//
//go:embed prompts/review-narrative/v2.md
var ReviewNarrativePromptV2 string

// NotePolishPromptV1 是笔记草稿润色的系统提示词。
//
//go:embed prompts/note-polish/v1.md
var NotePolishPromptV1 string

// MoodJournalPolishPromptV1 是心情日记块文档排版润色的系统提示词。
//
//go:embed prompts/mood-journal-polish/v1.md
var MoodJournalPolishPromptV1 string

// MoodJournalFollowUpPromptV1 是单篇日记保存后追问的系统提示词。
//
//go:embed prompts/mood-journal-follow-up/v1.md
var MoodJournalFollowUpPromptV1 string

// MoodReflectionPromptV1 是用户主动选择日记后的阶段回望系统提示词。
//
//go:embed prompts/mood-reflection/v1.md
var MoodReflectionPromptV1 string

// CaptureParseSchemaV1 是解析结果的完整 JSON Schema。
//
// 模型返回的原始 JSON 属于不可信输入，必须先通过它再进入 Domain 校验。
//
//go:embed schemas/capture/capture-parse-result.v1.schema.json
var CaptureParseSchemaV1 []byte

// CaptureParseSchemaV2 增加行程用途、目的地和结束日期字段。
//
//go:embed schemas/capture/capture-parse-result.v2.schema.json
var CaptureParseSchemaV2 []byte

// CaptureParseSchemaV3 增加行程安排与票据结构化字段。
//
//go:embed schemas/capture/capture-parse-result.v3.schema.json
var CaptureParseSchemaV3 []byte

// CaptureParseSchemaV4 增加稳定候选引用、更新目标与候选关系。
//
//go:embed schemas/capture/capture-parse-result.v4.schema.json
var CaptureParseSchemaV4 []byte

// ReviewNarrativeSchemaV2 是周复盘模型输出的完整 JSON Schema。
//
//go:embed schemas/review/review-narrative-result.v2.schema.json
var ReviewNarrativeSchemaV2 []byte

// NotePolishSchemaV1 是笔记润色结果的完整 JSON Schema。
//
//go:embed schemas/notes/note-polish-result.v1.schema.json
var NotePolishSchemaV1 []byte

// MoodJournalPolishSchemaV1 是心情日记排版润色结果的完整 JSON Schema。
//
//go:embed schemas/mood-journal/mood-journal-polish-result.v1.schema.json
var MoodJournalPolishSchemaV1 []byte

// MoodJournalFollowUpSchemaV1 是保存后追问结果的 JSON Schema。
//
//go:embed schemas/mood-journal/mood-journal-follow-up-result.v1.schema.json
var MoodJournalFollowUpSchemaV1 []byte

// MoodReflectionSchemaV1 是阶段回望结果的 JSON Schema。
//
//go:embed schemas/mood-journal/mood-reflection-result.v1.schema.json
var MoodReflectionSchemaV1 []byte

// 版本号随 Prompt 与 Schema 变化递增，写入 AI Action 审计记录。
const (
	CaptureParsePromptVersion        = "capture-parse@v6"
	VisionExtractPromptVersion       = "vision-extract@v1"
	AssistantPolicyVersion           = "assistant@v3"
	ReviewNarrativePromptVersion     = "review-narrative@v2"
	ReviewNarrativeSchemaVersion     = "review-narrative-result.v2"
	NotePolishPromptVersion          = "note-polish@v1"
	NotePolishSchemaVersion          = "note-polish-result.v1"
	MoodJournalPolishPromptVersion   = "mood-journal-polish@v1"
	MoodJournalPolishSchemaVersion   = "mood-journal-polish-result.v1"
	MoodJournalFollowUpPromptVersion = "mood-journal-follow-up@v1"
	MoodJournalFollowUpSchemaVersion = "mood-journal-follow-up-result.v1"
	MoodReflectionPromptVersion      = "mood-reflection@v1"
	MoodReflectionSchemaVersion      = "mood-reflection-result.v1"
	CaptureParseSchemaVersion        = "capture-parse-result.v4"
)

// ProposalGuardsSchemaV1 是建议前置条件与字段级时间来源的权威契约。
//
//go:embed schemas/assistant/proposal-guards.v1.schema.json
var ProposalGuardsSchemaV1 []byte

// CaptureParsePromptV6 区分用户控制意图与引用素材，不将随口说默认保存为笔记。
//
//go:embed prompts/capture-parse/v6.md
var CaptureParsePromptV6 string

// DismissProposalSchemaV1 是待确认建议撤回工具的输入契约。
//
//go:embed schemas/assistant/dismiss-proposal.v1.schema.json
var DismissProposalSchemaV1 []byte

// AskClarificationSchemaV1 是持久化澄清工具的输入契约。
//
//go:embed schemas/assistant/ask-clarification.v1.schema.json
var AskClarificationSchemaV1 []byte
