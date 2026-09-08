package openai

import (
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
)

// 只发送虚构验收样本，不访问或保存生产用户数据。
func TestLiveCaptureWeight(t *testing.T) {
	if os.Getenv("STEWARD_AI_LIVE_WEIGHT") != "1" {
		t.Skip("需显式启用体重记录真实模型验收")
	}
	_ = config.LoadForTest()
	p, err := New(Config{BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"), ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 2000, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	focus := ai.TrackerRef{ID: "tracker_focus", Name: "专注", Fields: []ai.TrackerFieldRef{{Key: "duration_min", Label: "时长", Type: "duration", Unit: "分钟", Required: true}}}
	weight := ai.TrackerRef{ID: "tracker_weight", Name: "体重", Fields: []ai.TrackerFieldRef{{Key: "weight_kg", Label: "体重", Type: "number", Unit: "kg", Required: true}}}
	cases := []struct {
		name, text string
		trackers   []ai.TrackerRef
		clarify    bool
		history    bool
	}{
		{"首次记录", "今天体重68.5公斤", nil, false, false},
		{"不能配到专注", "今天体重68.5公斤", []ai.TrackerRef{focus}, false, false},
		{"复用已有体重", "今天体重68.5公斤", []ai.TrackerRef{focus, weight}, false, false},
		{"缺数值", "记录体重", []ai.TrackerRef{focus}, true, false},
		{"只有数字", "今天68.5", []ai.TrackerRef{focus, weight}, true, false},
		{"旧选项补充", "今天体重68.5公斤", []ai.TrackerRef{focus}, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := ai.CaptureParseRequest{Now: time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC), Timezone: "Asia/Shanghai", Parts: []ai.InputPart{{ID: "part_weight", Kind: ai.PartText, Text: tc.text}}, Trackers: tc.trackers}
			if tc.history {
				req.Clarifications = []ai.CaptureClarification{{Question: "是否添加体重记录？", Answer: "创建新的体重追踪器", AnswerPartID: "part_answer"}}
				req.Parts = append(req.Parts, ai.InputPart{ID: "part_answer", Kind: ai.PartText, Position: 1001, Text: "创建新的体重追踪器"})
			}
			started := time.Now()
			r, err := p.ParseCapture(t.Context(), req)
			if err != nil {
				t.Fatal("模型未能返回有效候选")
			}
			t.Logf("耗时 %.2f 秒；候选 %d；澄清 %d", time.Since(started).Seconds(), len(r.Candidates), len(r.Questions))
			if tc.clarify {
				if len(r.Questions) == 0 || len(r.Candidates) != 0 {
					t.Fatal("缺少明确内容或数值时必须先澄清，不生成记录")
				}
				return
			}
			var tracker, record *ai.CandidateDraft
			for i := range r.Candidates {
				c := &r.Candidates[i]
				if c.Type == "tracker" {
					tracker = c
				}
				if c.Type == "record" {
					record = c
				}
			}
			if record == nil || len(record.RecordValues) != 1 || record.RecordValues[0].Number == nil || *record.RecordValues[0].Number != 68.5 {
				t.Fatal("明确体重没有完整保留")
			}
			if tc.name == "复用已有体重" {
				if tracker != nil || record.TrackerID != weight.ID {
					t.Fatal("未复用已有体重记录项")
				}
			} else {
				if tracker == nil || len(tracker.TrackerFields) != 1 || tracker.TrackerFields[0].Key != record.RecordValues[0].Key || tracker.TrackerFields[0].Unit != "kg" || record.TrackerRef != tracker.Ref {
					t.Fatal("新记录项字段与记录关联不完整")
				}
			}
			if len(r.Questions) != 0 {
				t.Fatal("已提供完整体重，不应要求先创建追踪器")
			}
		})
	}
}
