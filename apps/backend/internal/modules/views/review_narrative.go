package views

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/assets"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// Grounded Answer（后端指南 19.4）。
//
// 复盘叙述是可选增强：确定性指标先算好，模型只负责把它们讲成人话。
// 模型引用的每一个来源都必须在服务端给它的清单里；对不上的结论整条丢弃。
// 没有结论比编一个听起来合理的结论好。

// GenerateArgs 是 review.generate 的任务参数。
type GenerateArgs struct {
	SchemaVersion  int        `json:"schema_version"`
	UserID         string     `json:"user_id"`
	WeekOf         *time.Time `json:"week_of"`
	OperationID    string     `json:"operation_id"`
	IdempotencyKey string     `json:"idempotency_key"`
}

// GenerateAccepted 是提交生成任务的结果。
type GenerateAccepted struct {
	OperationID string
}

// GenerateWeeklyReview 登记一次叙述生成任务。
func (s *Service) GenerateWeeklyReview(ctx context.Context, userID string,
	weekOf *time.Time) (GenerateAccepted, error) {

	if s.jobs == nil {
		return GenerateAccepted{}, apperr.New(apperr.CodeAIProviderUnavailable)
	}

	var out GenerateAccepted
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		op, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID: idgen.New(idgen.PrefixOperation), UserID: userID, Kind: "review.generate",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		key := "review:weekly:current"
		if weekOf != nil {
			key = "review:weekly:" + weekOf.Format("2006-01-02")
		}
		if err := s.jobs.EnqueueReviewGenerate(ctx, q, GenerateArgs{
			SchemaVersion:  1,
			UserID:         userID,
			WeekOf:         weekOf,
			OperationID:    op.ID,
			IdempotencyKey: fmt.Sprintf("%s:%s", key, op.ID),
		}); err != nil {
			return err
		}
		out = GenerateAccepted{OperationID: op.ID}
		return nil
	})
	return out, err
}

// RunGenerate 执行一次叙述生成。Worker 调用它。
func (s *Service) RunGenerate(ctx context.Context, args GenerateArgs) error {
	// 第一步：算出确定性指标与来源清单。事务边界在 GetWeeklyReview 内部。
	review, err := s.GetWeeklyReview(ctx, args.UserID, args.WeekOf)
	if err != nil {
		return err
	}

	// 第二步：事务外调用模型。
	narrative, suggestions, genErr := s.generateNarrative(ctx, args.UserID, review)

	// 第三步：短事务保存。生成失败也要落一份快照：
	// 指标本身是有价值的，不该因为模型不可用而整份丢掉。
	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		metrics, err := json.Marshal(review.Metrics)
		if err != nil {
			return apperr.Internal(err)
		}
		sources, err := json.Marshal(review.Sources)
		if err != nil {
			return apperr.Internal(err)
		}
		suggestionsJSON, err := json.Marshal(suggestions)
		if err != nil {
			return apperr.Internal(err)
		}

		loc := timeutil.LoadLocation(review.Timezone)
		periodStart := review.PeriodStart.Time.In(loc)
		periodEnd := review.PeriodEnd.Time.In(loc)

		params := dbgen.UpsertReviewSnapshotParams{
			ID:          idgen.New(idgen.PrefixReviewSnapshot),
			UserID:      args.UserID,
			PeriodKind:  "weekly",
			PeriodStart: periodStart,
			PeriodEnd:   periodEnd,
			Metrics:     metrics,
			Suggestions: suggestionsJSON,
			Sources:     sources,
			GeneratedBy: "system",
		}
		if genErr == nil && narrative != "" {
			now := time.Now()
			version := assets.ReviewNarrativePromptVersion
			params.Narrative = &narrative
			params.GeneratedBy = "ai"
			params.PromptVersion = &version
			params.GeneratedAt = &now
		}
		if _, err := q.UpsertReviewSnapshot(ctx, params); err != nil {
			return apperr.Internal(err)
		}

		status := "succeeded"
		var errBody []byte
		if genErr != nil {
			s.logger.Warn("复盘叙述生成失败，只保留指标",
				"user_id", args.UserID, "error", genErr)
			appErr := apperr.New(apperr.CodeAIProviderUnavailable)
			errBody, _ = json.Marshal(map[string]any{
				"code":      string(apperr.CodeAIProviderUnavailable),
				"message":   "复盘小结暂时生成不了，指标仍然可用。",
				"retryable": appErr.Retryable(),
			})
			status = "failed"
		}
		resultRef, _ := json.Marshal(map[string]any{
			"type":         "review",
			"period_kind":  "weekly",
			"period_start": review.PeriodStart.String(),
		})
		if status == "failed" {
			resultRef = nil
		}

		progress := int32(100)
		if _, err := q.UpdateOperationStatus(ctx, dbgen.UpdateOperationStatusParams{
			ID: args.OperationID, Status: status, Progress: &progress,
			ResultRef: resultRef, Error: errBody,
		}); err != nil {
			return apperr.Internal(err)
		}
		if err := q.SaveProcessedJob(ctx, dbgen.SaveProcessedJobParams{
			IdempotencyKey: args.IdempotencyKey,
			UserID:         args.UserID,
			Kind:           "review.generate",
			ResultRef:      resultRef,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// narrativeOutput 是模型的输出契约。
type narrativeOutput struct {
	Narrative   string `json:"narrative"`
	Suggestions []struct {
		Text       string   `json:"text"`
		SourceRefs []string `json:"source_refs"`
	} `json:"suggestions"`
}

// generateNarrative 调用模型并校验来源。
// userID 只用于写审计——叙述生成本身不按用户分支，
// 但「谁的这次调用花了多少 token」得记得下来。
func (s *Service) generateNarrative(ctx context.Context, userID string,
	review httpapi.WeeklyReview) (string, []httpapi.ReviewSuggestion, error) {

	if s.chat == nil {
		return "", []httpapi.ReviewSuggestion{}, ai.ErrProviderUnavailable
	}

	// 允许引用的来源集合。模型只能在这个集合里挑，不能自己造 ID。
	allowed := make(map[string]httpapi.ReviewSource, len(review.Sources))
	for _, src := range review.Sources {
		allowed[src.ResourceType+":"+src.ResourceId] = src
	}

	input := renderReviewInput(review)
	result, err := s.chat.Complete(ctx, ai.CompletionRequest{
		Messages: []ai.Message{
			{Role: ai.RoleSystem, Content: assets.ReviewNarrativePromptV1},
			{Role: ai.RoleUser, Content: input},
		},
		MaxOutputTokens: 800,
	})

	// 记一笔审计。**只记形状不记正文**：复盘输入含用户一周的活动摘要，
	// 是最不该在审计表里再存一份的东西。
	s.audit.Record(ctx, aiaudit.Entry{
		UserID:        userID,
		Feature:       aiaudit.FeatureReview,
		EngineType:    "single_shot",
		ModelPolicy:   "chat",
		ProviderModel: s.chat.ModelName(),
		PromptVersion: assets.ReviewNarrativePromptVersion,
		InputHash:     aiaudit.Hash(input),
		OutputHash:    aiaudit.Hash(result.Content),
		Status:        aiaudit.StatusFor(err),
		ErrorClass:    aiaudit.ClassifyError(err),
		Usage:         result.Usage,
	})

	if err != nil {
		return "", []httpapi.ReviewSuggestion{}, err
	}

	var parsed narrativeOutput
	if err := json.Unmarshal([]byte(stripCodeFence(result.Content)), &parsed); err != nil {
		return "", []httpapi.ReviewSuggestion{}, fmt.Errorf("%w: 叙述输出不是合法 JSON", ai.ErrSchemaInvalid)
	}

	suggestions := make([]httpapi.ReviewSuggestion, 0, len(parsed.Suggestions))
	for _, item := range parsed.Suggestions {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}
		// 没有来源的结论必须被拒绝，编造来源的同样丢弃。
		refs := make([]httpapi.ReviewSource, 0, len(item.SourceRefs))
		valid := true
		for _, ref := range item.SourceRefs {
			src, ok := allowed[ref]
			if !ok {
				s.logger.Warn("复盘建议引用了不存在的来源，已丢弃",
					"ref", ref, "suggestion", text)
				valid = false
				break
			}
			refs = append(refs, src)
		}
		if !valid || len(refs) == 0 {
			continue
		}
		suggestions = append(suggestions, httpapi.ReviewSuggestion{
			Id: idgen.New(idgen.PrefixReviewSuggestion), Text: text, SourceRefs: refs,
		})
		if len(suggestions) >= 3 {
			break
		}
	}

	return strings.TrimSpace(parsed.Narrative), suggestions, nil
}

// renderReviewInput 把指标与来源清单渲染成模型输入。
//
// 只给标题不给正文：写一段周总结不需要读完每条任务的描述。
func renderReviewInput(review httpapi.WeeklyReview) string {
	var b strings.Builder
	fmt.Fprintf(&b, "周期：%s 至 %s\n\n本周指标：\n",
		review.PeriodStart.String(), review.PeriodEnd.String())
	for _, m := range review.Metrics {
		unit := ""
		if m.Unit != nil {
			unit = *m.Unit
		}
		fmt.Fprintf(&b, "- %s：%.0f%s", m.Label, m.Value, unit)
		if m.DeltaVsPrevious != nil {
			fmt.Fprintf(&b, "（较上周 %+.0f）", *m.DeltaVsPrevious)
		}
		b.WriteString("\n")
	}

	b.WriteString("\n可引用的来源清单（只能用这里的 ID）：\n")
	if len(review.Sources) == 0 {
		b.WriteString("（本周没有可引用的来源，suggestions 必须返回空数组）\n")
	}
	for _, src := range review.Sources {
		fmt.Fprintf(&b, "- %s:%s —— %s\n", src.ResourceType, src.ResourceId, src.Title)
	}
	return b.String()
}

// stripCodeFence 去掉模型可能加上的代码块围栏。
func stripCodeFence(s string) string {
	trimmed := strings.TrimSpace(s)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	if idx := strings.Index(trimmed, "\n"); idx >= 0 {
		trimmed = trimmed[idx+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed), "```"))
}
