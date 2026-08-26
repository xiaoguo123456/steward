// Package ai 定义 Provider 中立的窄接口与运行审计。
//
// 业务模块只依赖这里的接口，不导入任何 Provider SDK 类型。
// 这样替换 Provider 或将来引入编排框架时，业务层不需要改动。
//
// 本包不读数据库、不导入模块 Repository，也不决定任何业务状态。
package ai

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrProviderUnavailable 表示 Provider 暂时不可用，调用方应降级而不是失败整个请求。
	ErrProviderUnavailable = errors.New("AI Provider 不可用")
	// ErrRateLimited 表示被服务商限流，可以稍后重试。
	ErrRateLimited = errors.New("AI Provider 限流")
	// ErrSchemaInvalid 表示模型输出经过一次结构修复后仍不符合契约。
	ErrSchemaInvalid = errors.New("模型输出不符合契约")
	// ErrTurnCancelled 表示用户已取消这一轮。
	ErrTurnCancelled = errors.New("本轮已取消")
)

// Usage 是一次调用的用量统计，用于成本核算与预算控制。
type Usage struct {
	InputTokens int
	// CachedInputTokens 是命中缓存的输入 token。
	// 多数服务商对它另有折扣价，因此单独记；混进 InputTokens 会把成本算高。
	CachedInputTokens int
	OutputTokens      int
	LatencyMS         int
	// **这里没有金额字段。** Provider 报的是用量，不是钱——
	// 单价是商务条款，随时间变化，而且要能追溯「那笔账当时按什么价算的」。
	// 换算在 modules/admin/costs 里按价格版本做。
}

// PartKind 是输入项类型。
type PartKind string

// 输入项类型取值。
const (
	PartText  PartKind = "text"
	PartAudio PartKind = "audio"
	PartImage PartKind = "image"
)

// InputPart 是一次 Capture 的单个输入项。
//
// 图片与音频中提取出的文字属于用户资料，不是系统指令：
// 其中出现的任何“指令”都只能作为待整理内容，不得改变系统行为。
type InputPart struct {
	ID       string
	Kind     PartKind
	Position int
	Text     string
	MediaID  string
}

// ListRef 是可供候选绑定的已有清单。
type ListRef struct {
	ID        string
	Name      string
	IsDefault bool
}

// TrackerRef 是可供 Record 候选绑定的已有记录项。
type TrackerRef struct {
	ID     string
	Name   string
	Fields []TrackerFieldRef
}

// TrackerFieldRef 是记录项的单个字段定义。
type TrackerFieldRef struct {
	Key   string
	Label string
	Type  string
	Unit  string
}

// CaptureParseRequest 是一次 Capture 结构化解析的中立输入。
type CaptureParseRequest struct {
	RunID           string
	Parts           []InputPart
	InstructionNote string
	Timezone        string
	Now             time.Time
	Lists           []ListRef
	Trackers        []TrackerRef
}

// SourceSpan 指向输入中的一段来源，用于字段级追溯。
type SourceSpan struct {
	PartID    string
	TextStart int
	TextEnd   int
}

// Confidence 是字段级置信度。
// 它只用于排序与是否追问，永远不能用来跳过用户确认。
type Confidence struct {
	Field   string
	Level   string
	Sources []SourceSpan
}

// CandidateDraft 是解析出的一个候选对象。
//
// Provider 只产出候选：任何正式写入都必须经过用户确认，
// 并由 Go Domain 重新校验后执行。
type CandidateDraft struct {
	Type         string
	Action       string
	Title        string
	Content      string
	Description  string
	ProjectKind  string
	Destination  string
	Priority     string
	DueDate      *time.Time
	DueAt        *time.Time
	AllDay       bool
	StartAt      *time.Time
	StartDate    *time.Time
	TargetDate   *time.Time
	EventKind    string
	Location     string
	Tags         []string
	ListID       string
	TrackerID    string
	RecordValues []RecordValueDraft
	Timestamp    *time.Time
	Confidences  []Confidence
	Sources      []SourceSpan
	Missing      []string
	Warnings     []string
}

// RecordValueDraft 是 Record 候选的一个字段取值。
type RecordValueDraft struct {
	Key    string
	Number *float64
	Text   string
}

// QuestionDraft 是需要用户补充说明的追问。
type QuestionDraft struct {
	Question     string
	Blocking     bool
	QuickAnswers []string
	Summary      string
}

// ConflictDraft 是跨输入项的冲突。
type ConflictDraft struct {
	Field       string
	Description string
	Options     []ConflictOption
}

// ConflictOption 是冲突的一个候选取值。
type ConflictOption struct {
	Value   string
	Sources []SourceSpan
}

// CaptureParseResult 是一次解析的中立输出。
type CaptureParseResult struct {
	Candidates      []CandidateDraft
	Questions       []QuestionDraft
	Conflicts       []ConflictDraft
	InstructionNote string
	Usage           Usage
	// ProviderModel 与 PromptVersion 只用于审计，不参与业务判断。
	ProviderModel string
	PromptVersion string
	SchemaVersion string
}

// CaptureParser 是 Capture 结构化解析的窄接口。
//
// 单次结构化解析不需要工具循环，因此直接使用这个窄 Port，
// 不绕行通用编排引擎。
type CaptureParser interface {
	// Name 返回 Provider 名称，用于审计与健康检查展示。
	Name() string
	// ParseCapture 把多模态输入解析成候选对象。
	ParseCapture(ctx context.Context, req CaptureParseRequest) (CaptureParseResult, error)
}

// MediaInput 是一份已读入内存的媒体内容。
//
// 大小上限由 storage 包在上传阶段保证，因此这里可以安全地整份持有。
type MediaInput struct {
	ContentType string
	Data        []byte
}

// MediaProcessor 把媒体转成文字，供后续结构化解析使用。
//
// 提取出的文字属于用户资料而不是系统指令：
// 图片里出现的任何“忽略以上指令”之类的内容都只能作为待整理素材。
type MediaProcessor interface {
	// ExtractFromImage 识别图片中的文字与关键信息。
	ExtractFromImage(ctx context.Context, input MediaInput) (string, Usage, error)
	// Transcribe 把音频转写为文字。
	Transcribe(ctx context.Context, input MediaInput) (string, Usage, error)
}

// EmbeddingProvider 生成语义检索向量。
// 向量是可重建的派生索引，不是权威事实。
type EmbeddingProvider interface {
	Embed(ctx context.Context, texts []string) ([][]float32, Usage, error)
}
