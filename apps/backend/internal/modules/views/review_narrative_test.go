package views

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// Grounded Answer 的硬不变量：没有来源的结论必须被拒绝。
//
// 模型很容易生成一句听起来合理但没有依据的建议；这里保证那种建议
// 到不了用户面前，而不是靠 Prompt 里的一句"不要编造"。

type stubChat struct {
	content string
	err     error
}

func (s stubChat) Complete(context.Context, ai.CompletionRequest) (ai.CompletionResult, error) {
	if s.err != nil {
		return ai.CompletionResult{}, s.err
	}
	return ai.CompletionResult{Content: s.content}, nil
}

func (stubChat) Name() string { return "stub" }

func (stubChat) ModelName() string { return "stub" }

func sampleReview() httpapi.WeeklyReview {
	return httpapi.WeeklyReview{
		PeriodStart: openapi_types.Date{},
		PeriodEnd:   openapi_types.Date{},
		Timezone:    "Asia/Shanghai",
		Metrics: []httpapi.ReviewMetric{
			{Key: "tasks_completed", Label: "完成任务", Value: 3},
		},
		Sources: []httpapi.ReviewSource{
			{ResourceType: "task", ResourceId: "tsk_real", Title: "写季度报告"},
		},
	}
}

func serviceWith(content string) *Service {
	return &Service{
		chat:   stubChat{content: content},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func structuredOutput(highlights, suggestions []map[string]any) string {
	if highlights == nil {
		highlights = []map[string]any{}
	}
	if suggestions == nil {
		suggestions = []map[string]any{}
	}
	raw, _ := json.Marshal(map[string]any{
		"headline":    "本周完成三项任务",
		"summary":     "这周完成了三件事。",
		"highlights":  highlights,
		"suggestions": suggestions,
	})
	return string(raw)
}

func TestNarrativeKeepsOnlyGroundedSuggestions(t *testing.T) {
	content := structuredOutput(nil, []map[string]any{
		{"text": "把报告排到下周一。", "source_refs": []string{"task:tsk_real"}},
		{"text": "你最近睡得不好，早点休息。", "source_refs": []string{"task:tsk_编造"}},
	})

	generated, err := serviceWith(content).
		generateNarrative(context.Background(), "usr_test", sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if generated.Headline != "本周完成三项任务" || generated.Summary != "这周完成了三件事。" {
		t.Errorf("结构化正文不对：%+v", generated)
	}
	if len(generated.Suggestions) != 1 {
		t.Fatalf("只有一条建议有真实来源，实际保留 %d 条：%v",
			len(generated.Suggestions), generated.Suggestions)
	}
	if generated.Suggestions[0].Text != "把报告排到下周一。" {
		t.Errorf("保留的建议不对：%q", generated.Suggestions[0].Text)
	}
	if len(generated.Suggestions[0].SourceRefs) != 1 ||
		generated.Suggestions[0].SourceRefs[0].ResourceId != "tsk_real" {
		t.Errorf("来源没有还原成完整引用：%v", generated.Suggestions[0].SourceRefs)
	}
	if generated.Suggestions[0].Id == "" {
		t.Error("每条建议都要有稳定 ID，客户端要靠它做去重")
	}
}

// 模型给的一条建议里混入了编造来源时整条丢弃，不做"保留能对上的那部分"。
func TestNarrativeDropsSuggestionWithAnyFabricatedSource(t *testing.T) {
	content := structuredOutput(nil, []map[string]any{{
		"text":        "两个来源一真一假。",
		"source_refs": []string{"task:tsk_real", "task:tsk_假的"},
	}})

	generated, err := serviceWith(content).
		generateNarrative(context.Background(), "usr_test", sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if len(generated.Suggestions) != 0 {
		t.Errorf("混入编造来源的建议应当整条丢弃，实际保留 %d 条", len(generated.Suggestions))
	}
}

func TestNarrativeKeepsOnlyKnownUniqueHighlights(t *testing.T) {
	content := structuredOutput([]map[string]any{
		{"metric_key": "tasks_completed", "comment": "较上周增加"},
		{"metric_key": "fabricated", "comment": "不存在"},
	}, nil)

	generated, err := serviceWith(content).
		generateNarrative(context.Background(), "usr_test", sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if len(generated.Highlights) != 1 || generated.Highlights[0].MetricKey != "tasks_completed" {
		t.Errorf("只应保留真实指标重点：%v", generated.Highlights)
	}
}

// 输出不是合法 JSON 或缺少字段时按契约失败，让调用方只保留指标。
func TestNarrativeRejectsMalformedOutput(t *testing.T) {
	if _, err := serviceWith("这不是 JSON").
		generateNarrative(context.Background(), "usr_test", sampleReview()); err == nil {
		t.Fatal("非法输出必须报错，不能当成没有叙述静默通过")
	}
	if _, err := serviceWith(`{"summary":"缺少字段"}`).
		generateNarrative(context.Background(), "usr_test", sampleReview()); err == nil {
		t.Fatal("不符合 Schema 的输出必须报错")
	}
}

// 模型习惯性加代码块围栏时也要能解析出来。
func TestNarrativeStripsCodeFence(t *testing.T) {
	content := "```json\n" + structuredOutput(nil, nil) + "\n```"
	generated, err := serviceWith(content).
		generateNarrative(context.Background(), "usr_test", sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if generated.Summary != "这周完成了三件事。" {
		t.Errorf("围栏没有去掉：%q", generated.Summary)
	}
}

// 没有配置对话模型时明确报不可用，而不是返回一段空叙述冒充成功。
func TestNarrativeWithoutProviderIsUnavailable(t *testing.T) {
	svc := &Service{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if _, err := svc.generateNarrative(context.Background(), "usr_test", sampleReview()); err == nil {
		t.Fatal("没有 Provider 时必须报错")
	}
}

func TestHasReviewableDataSkipsOnlyTrulyEmptyWeek(t *testing.T) {
	empty := httpapi.WeeklyReview{Metrics: []httpapi.ReviewMetric{{Value: 0}}}
	if hasReviewableData(empty) {
		t.Fatal("指标和变化全为零时不应调用模型")
	}
	delta := -3.0
	empty.Metrics[0].DeltaVsPrevious = &delta
	if !hasReviewableData(empty) {
		t.Fatal("本周为零但较上周有变化时仍应生成复盘")
	}
}

func TestReviewInputIncludesStableMetricKey(t *testing.T) {
	input := renderReviewInput(sampleReview())
	if !strings.Contains(input, "metric_key=tasks_completed") {
		t.Fatalf("模型必须看到可原样引用的指标 key：%s", input)
	}
}

func TestApplySnapshotRestoresStructuredContent(t *testing.T) {
	headline := "本周推进明确"
	summary := "完成了三项任务。"
	highlights, _ := json.Marshal([]httpapi.ReviewHighlight{{
		MetricKey: "tasks_completed", Comment: "较上周增加",
	}})
	review := httpapi.WeeklyReview{Highlights: []httpapi.ReviewHighlight{}}
	applySnapshot(&review, dbgen.ReviewSnapshot{
		Headline: &headline, Narrative: &summary, Highlights: highlights,
		Suggestions: []byte("[]"),
	})

	if review.Headline == nil || *review.Headline != headline ||
		review.Narrative == nil || *review.Narrative != summary {
		t.Fatalf("标题与摘要没有恢复：%+v", review)
	}
	if len(review.Highlights) != 1 || review.Highlights[0].MetricKey != "tasks_completed" {
		t.Fatalf("指标重点没有恢复：%v", review.Highlights)
	}
}
