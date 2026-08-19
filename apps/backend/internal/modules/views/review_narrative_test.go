package views

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	openapi_types "github.com/oapi-codegen/runtime/types"

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

func TestNarrativeKeepsOnlyGroundedSuggestions(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"narrative": "这周完成了三件事。",
		"suggestions": []map[string]any{
			{"text": "把报告排到下周一。", "source_refs": []string{"task:tsk_real"}},
			{"text": "你最近睡得不好，早点休息。", "source_refs": []string{"task:tsk_编造"}},
			{"text": "继续保持。", "source_refs": []string{}},
		},
	})

	narrative, suggestions, err := serviceWith(string(raw)).
		generateNarrative(context.Background(), sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if narrative != "这周完成了三件事。" {
		t.Errorf("叙述不对：%q", narrative)
	}
	if len(suggestions) != 1 {
		t.Fatalf("只有一条建议有真实来源，实际保留 %d 条：%v", len(suggestions), suggestions)
	}
	if suggestions[0].Text != "把报告排到下周一。" {
		t.Errorf("保留的建议不对：%q", suggestions[0].Text)
	}
	if len(suggestions[0].SourceRefs) != 1 ||
		suggestions[0].SourceRefs[0].ResourceId != "tsk_real" {
		t.Errorf("来源没有还原成完整引用：%v", suggestions[0].SourceRefs)
	}
	if suggestions[0].Id == "" {
		t.Error("每条建议都要有稳定 ID，客户端要靠它做去重")
	}
}

// 模型给的一条建议里混入了编造来源时整条丢弃，不做"保留能对上的那部分"。
func TestNarrativeDropsSuggestionWithAnyFabricatedSource(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"narrative": "还行。",
		"suggestions": []map[string]any{
			{"text": "两个来源一真一假。",
				"source_refs": []string{"task:tsk_real", "task:tsk_假的"}},
		},
	})

	_, suggestions, err := serviceWith(string(raw)).
		generateNarrative(context.Background(), sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if len(suggestions) != 0 {
		t.Errorf("混入编造来源的建议应当整条丢弃，实际保留 %d 条", len(suggestions))
	}
}

// 输出不是合法 JSON 时按契约失败，让调用方只保留指标。
func TestNarrativeRejectsMalformedOutput(t *testing.T) {
	_, _, err := serviceWith("这不是 JSON").
		generateNarrative(context.Background(), sampleReview())
	if err == nil {
		t.Fatal("非法输出必须报错，不能当成没有叙述静默通过")
	}
}

// 模型习惯性加代码块围栏时也要能解析出来。
func TestNarrativeStripsCodeFence(t *testing.T) {
	content := "```json\n{\"narrative\":\"好的。\",\"suggestions\":[]}\n```"
	narrative, _, err := serviceWith(content).
		generateNarrative(context.Background(), sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if narrative != "好的。" {
		t.Errorf("围栏没有去掉：%q", narrative)
	}
}

// 没有配置对话模型时明确报不可用，而不是返回一段空叙述冒充成功。
func TestNarrativeWithoutProviderIsUnavailable(t *testing.T) {
	svc := &Service{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if _, _, err := svc.generateNarrative(context.Background(), sampleReview()); err == nil {
		t.Fatal("没有 Provider 时必须报错")
	}
}

// 建议最多三条，避免复盘页被刷屏。
func TestNarrativeCapsSuggestions(t *testing.T) {
	items := make([]map[string]any, 0, 6)
	for i := 0; i < 6; i++ {
		items = append(items, map[string]any{
			"text": "建议", "source_refs": []string{"task:tsk_real"},
		})
	}
	raw, _ := json.Marshal(map[string]any{"narrative": "n", "suggestions": items})

	_, suggestions, err := serviceWith(string(raw)).
		generateNarrative(context.Background(), sampleReview())
	if err != nil {
		t.Fatalf("不该出错：%v", err)
	}
	if len(suggestions) != 3 {
		t.Errorf("最多保留 3 条，实际 %d 条", len(suggestions))
	}
}
