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

func TestLiveCaptureCheckins(t *testing.T) {
	if os.Getenv("STEWARD_AI_LIVE_CHECKINS") != "1" {
		t.Skip("需显式启用打卡真实模型验收")
	}
	_ = config.LoadForTest()
	provider, err := New(Config{BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"), ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 2500, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	water := ai.TrackerRef{ID: "water_a", Name: "饮水", Fields: []ai.TrackerFieldRef{{Key: "water_ml", Label: "饮水量", Type: "number", Unit: "毫升", Required: true}}}
	waterOther := water
	waterOther.ID = "water_b"
	cases := []struct {
		name, text string
		record     bool
		value      float64
		fields     int
		frequency  string
		weekdays   []int
		clarify    bool
		existing   []ai.TrackerRef
	}{
		{name: "只建饮水打卡", text: "新建一个饮水打卡，记录饮水量，单位毫升", fields: 1},
		{name: "饮水记录", text: "今天喝了500毫升水，帮我记录饮水", record: true, value: 500, fields: 1},
		{name: "睡眠记录", text: "昨晚睡了7.5小时，帮我记录睡眠", record: true, value: 7.5, fields: 1},
		{name: "阅读记录", text: "今天阅读30分钟，记录一下阅读时长", record: true, value: 30, fields: 1},
		{name: "每天阅读", text: "新建打卡：每天阅读，记录阅读分钟数和页数", fields: 2, frequency: "daily"},
		{name: "每周阅读", text: "新建阅读打卡，每周一三五打卡，记录阅读分钟数", fields: 1, frequency: "weekly", weekdays: []int{1, 3, 5}},
		{name: "重复名称", text: "今天喝了500毫升水，记录到饮水", record: true, clarify: true, existing: []ai.TrackerRef{water, waterOther}},
		{name: "无意义输入", text: "啊啊啊？？？", clarify: true},
		{name: "缺少每周星期", text: "新建一个每周打卡的阅读项目，记录阅读分钟数", clarify: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			started := time.Now()
			r, err := provider.ParseCapture(t.Context(), ai.CaptureParseRequest{Now: time.Date(2026, 9, 8, 10, 0, 0, 0, time.UTC), Timezone: "Asia/Shanghai", Parts: []ai.InputPart{{ID: "part_checkin", Kind: ai.PartText, Text: tc.text}}, Trackers: tc.existing})
			if err != nil {
				t.Fatal("模型没有返回有效结果")
			}
			t.Logf("耗时 %.2f 秒；候选 %d；澄清 %d", time.Since(started).Seconds(), len(r.Candidates), len(r.Questions))
			if tc.clarify {
				if len(r.Questions) == 0 {
					t.Fatal("存在真实歧义时必须澄清")
				}
				for _, q := range r.Questions {
					if !q.Blocking {
						t.Fatal("该歧义必须阻塞本次确认")
					}
				}
				if tc.name == "重复名称" || tc.name == "无意义输入" {
					if len(r.Candidates) != 0 {
						t.Fatal("不得给未确定目标或无意义输入生成候选")
					}
				}
				return
			}
			var tracker, record *ai.CandidateDraft
			for i := range r.Candidates {
				c := &r.Candidates[i]
				switch c.Type {
				case "tracker":
					if tracker != nil {
						t.Fatal("不应重复生成记录项")
					}
					tracker = c
				case "record":
					record = c
				default:
					t.Fatal("打卡不应误判成任务或笔记")
				}
			}
			if tracker == nil || len(tracker.TrackerFields) != tc.fields {
				t.Fatal("打卡字段不完整")
			}
			if tc.record {
				if record == nil || record.TrackerRef != tracker.Ref || len(record.RecordValues) != 1 || record.RecordValues[0].Number == nil || *record.RecordValues[0].Number != tc.value {
					t.Fatal("本次记录数值或关联不正确")
				}
			} else if record != nil {
				t.Fatal("只建立打卡项不能虚构一次记录")
			}
			if tc.frequency != "" {
				if tracker.TrackerSchedule == nil || tracker.TrackerSchedule.Frequency != tc.frequency {
					t.Fatal("打卡频率丢失")
				}
				if len(tc.weekdays) > 0 {
					days := tracker.TrackerSchedule.Weekdays
					if len(days) != len(tc.weekdays) {
						t.Fatal("星期缺失")
					}
					for i, d := range days {
						if d != tc.weekdays[i] {
							t.Fatal("星期不正确")
						}
					}
				}
			} else if tracker.TrackerSchedule != nil {
				t.Fatal("未指定频率不能自动每天打卡")
			}
			if len(r.Questions) != 0 {
				t.Fatal("完整需求不应继续追问")
			}
		})
	}
}
