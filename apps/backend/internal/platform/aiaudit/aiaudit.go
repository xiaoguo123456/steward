// Package aiaudit 记录每一次模型调用。
//
// 记的是**形状不是内容**：哪个功能、走了哪个 Provider 与模型、
// 用了多少 token、花了多久、成没成功。用户说了什么、模型答了什么，
// 只留哈希，正文一个字都不进这张表。
//
// 这条约束不是可选的。AGENTS.md 写着「日志、埋点和测试快照不得包含
// Token、验证码、完整原始媒体或不必要的用户正文」，而审计表比日志更持久、
// 更容易被导出分析——它反而是最不该存正文的地方。因此 Entry 里
// **压根没有存正文的字段**：想存也存不进去。
//
// 普通审计记录失败不影响用户：写不进去只记日志。只有业务实体需要引用
// ai_action_id 作为来源时，才通过 RecordRequired 要求审计与来源一起成功。
package aiaudit

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 功能分类。取值必须落在 ai_actions_feature_check 之内。
const (
	FeatureCapture   = "capture"
	FeatureAssistant = "assistant"
	FeatureSearch    = "search"
	FeatureReview    = "review"
	FeatureMemory    = "memory"
)

// 调用结果。取值必须落在 ai_actions_status_check 之内。
const (
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
	// StatusSkipped 表示这次压根没调模型（比如降级到本地确定性解析）。
	// 它和 failed 要分开：把降级记成失败，失败率会永远居高不下。
	StatusSkipped = "skipped"
)

// Entry 是一条待记录的调用。
//
// **这里没有任何存放正文的字段**，只有哈希。要对比两次调用的输入是否相同，
// 比哈希；要看用户到底说了什么，去看他自己的 Capture 或会话记录——
// 那些是用户的数据，有 RLS 管着，不该在审计表里再存一份。
type Entry struct {
	UserID  string
	Feature string
	// RunID 串起同一次编排里的多步调用。
	RunID string

	EngineType    string
	EngineVersion string
	Provider      string
	// ModelPolicy 是「按用途选模型」里的用途名（parse / chat / vision…），
	// ProviderModel 是那一刻实际用的模型。换模型时前者不变，后者会变。
	ModelPolicy   string
	ProviderModel string
	PromptVersion string
	SchemaVersion string

	// InputRefs 指向输入来自哪些资源（Capture 分片 ID 之类），不含正文。
	InputRefs  []string
	InputHash  []byte
	OutputHash []byte

	Status     string
	ErrorClass string

	Usage ai.Usage
}

// Recorder 把调用记录写进 ai_actions。
type Recorder struct {
	db     *database.DB
	logger *slog.Logger
}

// New 构造 Recorder。db 为 nil 时所有写入都是空操作，
// 方便在不需要审计的测试里直接跳过。
func New(db *database.DB, logger *slog.Logger) *Recorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Recorder{db: db, logger: logger}
}

// Hash 把若干段文字压成一个摘要，用于判断两次调用的输入是否相同。
//
// 分段之间插入分隔符，避免 ("ab","c") 与 ("a","bc") 撞成同一个值。
func Hash(parts ...string) []byte {
	if len(parts) == 0 {
		return nil
	}
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return h.Sum(nil)
}

// Record 写入一条审计。
//
// 不返回错误：审计写不进去是我们的问题，不该让用户的整理跟着失败。
// 失败只记日志，而且**日志里同样不带正文**。
func (r *Recorder) Record(ctx context.Context, e Entry) {
	_, err := r.record(ctx, e)
	if err != nil && r != nil && r.logger != nil {
		r.logger.Error("AI 审计写入失败",
			"feature", e.Feature, "run_id", e.RunID, "error", err)
	}
}

// RecordRequired 写入一条需要被业务实体引用的 AI Action，并返回真实 ID。
//
// 普通审计失败不影响用户；但当 Note 要把 ai_action 写进 provenance_refs 时，
// 一个不存在的来源比明确失败更糟，因此这条窄路径把错误交还调用方处理。
func (r *Recorder) RecordRequired(ctx context.Context, e Entry) (string, error) {
	return r.record(ctx, e)
}

func (r *Recorder) record(ctx context.Context, e Entry) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("AI 审计记录器未配置")
	}
	if e.UserID == "" || e.Feature == "" || e.Status == "" {
		return "", errors.New("AI 审计缺少必填字段")
	}

	refs, err := json.Marshal(orEmpty(e.InputRefs))
	if err != nil {
		refs = []byte("[]")
	}
	actionID := idgen.New(idgen.PrefixAIAction)

	// 用户的请求可能已经取消（关掉页面、超时），但那一次模型调用是真花了钱的，
	// 恰恰最该记下来。所以脱开原 ctx 的取消信号，另给一个短超时。
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()

	err = r.db.InTx(writeCtx, e.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		return q.RecordAiAction(ctx, dbgen.RecordAiActionParams{
			ID:            actionID,
			UserID:        e.UserID,
			Feature:       e.Feature,
			RunID:         e.RunID,
			EngineType:    e.EngineType,
			EngineVersion: e.EngineVersion,
			Provider:      e.Provider,
			ModelPolicy:   e.ModelPolicy,
			ProviderModel: e.ProviderModel,
			PromptVersion: e.PromptVersion,
			SchemaVersion: e.SchemaVersion,
			InputRefs:     refs,
			InputHash:     e.InputHash,
			OutputHash:    e.OutputHash,
			Status:        e.Status,
			ErrorClass:    nilIfEmpty(e.ErrorClass),
			InputTokens:   int32(e.Usage.InputTokens),
			OutputTokens:  int32(e.Usage.OutputTokens),
			// 缓存命中的输入 token 单独记：多数服务商对它另有折扣价，
			// 混进 input_tokens 会把成本算高。
			CachedInputTokens: int32(e.Usage.CachedInputTokens),
			LatencyMs:         int32(e.Usage.LatencyMS),
		})
	})
	if err != nil {
		return "", err
	}
	return actionID, nil
}

func orEmpty(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func nilIfEmpty(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

// ClassifyError 把错误归到一个稳定的类别。
//
// 分类要**稳定且有限**：审计的用途是「按类别看失败率」，
// 把原始错误信息塞进去会得到成千上万个只出现一次的取值，
// 既聚不了合也可能带出正文（错误里常常包含用户输入的片段）。
func ClassifyError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ai.ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, ai.ErrProviderUnavailable):
		return "provider_unavailable"
	case errors.Is(err, ai.ErrSchemaInvalid):
		return "schema_invalid"
	case errors.Is(err, ai.ErrTurnCancelled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	default:
		if appErr, ok := apperr.As(err); ok {
			return string(appErr.Code)
		}
		return "unknown"
	}
}

// StatusFor 按错误给出记录状态。
func StatusFor(err error) string {
	if err == nil {
		return StatusSucceeded
	}
	return StatusFailed
}
