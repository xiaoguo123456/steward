package openai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// TestLiveParseCaptureWithClarifications 用真实 Provider 验证多轮追问已经被回答后能收敛。
// 默认跳过，避免 CI 依赖外网；发布 Prompt 前可显式设置 STEWARD_LIVE_AI_TEST=1 运行。
func TestLiveParseCaptureWithClarifications(t *testing.T) {
	if os.Getenv("STEWARD_LIVE_AI_TEST") != "1" {
		t.Skip("仅在显式启用真实模型测试时运行")
	}

	provider, err := New(Config{
		BaseURL:         os.Getenv("STEWARD_AI_BASE_URL"),
		APIKey:          os.Getenv("STEWARD_AI_API_KEY"),
		ParseModel:      os.Getenv("STEWARD_AI_MODEL_PARSE"),
		ThinkingMode:    envOrDefault("STEWARD_AI_THINKING_MODE", "disabled"),
		Timeout:         60 * time.Second,
		MaxOutputTokens: 4096,
		Logger:          slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("创建真实 Provider 失败：%v", err)
	}

	now := time.Date(2026, 9, 3, 8, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	cases := []struct {
		name           string
		original       string
		clarifications []ai.CaptureClarification
		wantType       string
	}{
		{
			name:     "复诊时间分两轮补齐",
			original: "帮我安排一次复诊",
			clarifications: []ai.CaptureClarification{
				{Question: "复诊安排在哪一天？", Answer: "下周三", AnswerPartID: "answer_visit_day"},
				{Question: "几点、在哪里复诊？", Answer: "上午十点，在协和医院门诊楼", AnswerPartID: "answer_visit_place"},
			},
			wantType: "event",
		},
		{
			name:     "报告截止时间与清单分两轮补齐",
			original: "提醒我提交季度报告",
			clarifications: []ai.CaptureClarification{
				{Question: "报告什么时候截止？", Answer: "本周五下午六点", AnswerPartID: "answer_report_due"},
				{Question: "要放到哪个清单？", Answer: "工作清单", AnswerPartID: "answer_report_list"},
			},
			wantType: "task",
		},
		{
			name:     "聚餐日期时间地点连续补齐",
			original: "帮我安排周末和小李吃饭",
			clarifications: []ai.CaptureClarification{
				{Question: "周末具体是哪一天？", Answer: "周六", AnswerPartID: "answer_dinner_day"},
				{Question: "几点吃饭？", Answer: "晚上七点", AnswerPartID: "answer_dinner_time"},
				{Question: "在哪里吃饭？", Answer: "国贸店", AnswerPartID: "answer_dinner_place"},
			},
			wantType: "event",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parts := []ai.InputPart{{ID: "original", Kind: ai.PartText, Position: 0, Text: tc.original}}
			for i, clarification := range tc.clarifications {
				parts = append(parts, ai.InputPart{
					ID: clarification.AnswerPartID, Kind: ai.PartText,
					Position: clarificationPartPositionStart + i + 1, Text: clarification.Answer,
				})
			}

			ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
			defer cancel()
			result, err := provider.ParseCapture(ctx, ai.CaptureParseRequest{
				RunID:          "live-clarification-" + tc.name,
				Parts:          parts,
				Clarifications: tc.clarifications,
				Lists:          []ai.ListRef{{ID: "list_work", Name: "工作", IsDefault: true}},
				Timezone:       "Asia/Shanghai",
				Now:            now,
			})
			if err != nil {
				t.Fatalf("真实模型解析失败：%v", err)
			}
			if len(result.Questions) != 0 {
				t.Fatalf("信息已经补齐，不应继续追问，实际问题：%q", result.Questions[0].Question)
			}
			candidate := findCandidateType(result.Candidates, tc.wantType)
			if candidate == nil {
				t.Fatalf("期望得到 %s 候选，实际候选类型：%v", tc.wantType, candidateTypes(result.Candidates))
			}
			lastAnswerID := tc.clarifications[len(tc.clarifications)-1].AnswerPartID
			if !hasSource(candidate.Sources, lastAnswerID) {
				t.Fatalf("候选没有保留最后一轮回答来源 %s，实际来源：%+v", lastAnswerID, candidate.Sources)
			}
			t.Logf("通过：候选=%s，追问=%d，耗时=%dms", candidate.Type, len(result.Questions), result.Usage.LatencyMS)
		})
	}
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func findCandidateType(candidates []ai.CandidateDraft, candidateType string) *ai.CandidateDraft {
	for i := range candidates {
		if candidates[i].Type == candidateType {
			return &candidates[i]
		}
	}
	return nil
}

func candidateTypes(candidates []ai.CandidateDraft) []string {
	types := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		types = append(types, candidate.Type)
	}
	return types
}

func hasSource(sources []ai.SourceSpan, partID string) bool {
	for _, source := range sources {
		if source.PartID == partID {
			return true
		}
	}
	return false
}
