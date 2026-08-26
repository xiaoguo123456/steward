package fake

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// 固定基准时间：2026-08-19 是星期三，用它验证相对日期与星期解析。
var baseNow = time.Date(2026, 8, 19, 10, 0, 0, 0, time.FixedZone("CST", 8*3600))

func parse(t *testing.T, text string) ai.CaptureParseResult {
	t.Helper()
	result, err := New().ParseCapture(context.Background(), ai.CaptureParseRequest{
		Parts:    []ai.InputPart{{ID: "cpt_1", Kind: ai.PartText, Text: text}},
		Timezone: "Asia/Shanghai",
		Now:      baseNow,
		Lists:    []ai.ListRef{{ID: "tls_1", Name: "默认清单", IsDefault: true}},
	})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	return result
}

func TestParseTaskWithDeadline(t *testing.T) {
	// “周五前完成”表示截止日，标题里不应残留时间表达与“前”字。
	result := parse(t, "周五前完成季度报告")

	if len(result.Candidates) != 1 {
		t.Fatalf("期望 1 个候选，实际 %d 个", len(result.Candidates))
	}
	c := result.Candidates[0]
	if c.Type != "task" {
		t.Errorf("期望类型 task，实际 %s", c.Type)
	}
	if c.Title != "完成季度报告" {
		t.Errorf("标题应剥离时间表达与“前”，实际 %q", c.Title)
	}
	// 只有日期没有时刻时必须生成 due_date，不能补成当天 23:59。
	if c.DueDate == nil {
		t.Fatal("期望生成 due_date")
	}
	if c.DueAt != nil {
		t.Error("只有日期的截止不应生成 due_at")
	}
	if got := c.DueDate.Format("2006-01-02"); got != "2026-08-21" {
		t.Errorf("周三说“周五”应指向 2026-08-21，实际 %s", got)
	}
}

func TestParseEventWithClockTime(t *testing.T) {
	result := parse(t, "明天下午3点和张总开会")

	if len(result.Candidates) != 1 {
		t.Fatalf("期望 1 个候选，实际 %d 个", len(result.Candidates))
	}
	c := result.Candidates[0]
	if c.Type != "event" {
		t.Fatalf("期望类型 event，实际 %s", c.Type)
	}
	if c.AllDay {
		t.Error("有明确时刻时不应是全天事件")
	}
	if c.StartAt == nil {
		t.Fatal("期望生成 start_at")
	}
	if got := c.StartAt.Format("2006-01-02 15:04"); got != "2026-08-20 15:00" {
		t.Errorf("“明天下午3点”应为 2026-08-20 15:00，实际 %s", got)
	}
	if c.Title != "和张总开会" {
		t.Errorf("标题应剥离时间表达，实际 %q", c.Title)
	}
}

func TestParseEventWithoutClockBecomesAllDay(t *testing.T) {
	// 日期明确、时间不明确时保存为全天事件，并给出提示。
	result := parse(t, "后天和客户见面")

	c := result.Candidates[0]
	if c.Type != "event" || !c.AllDay {
		t.Fatalf("期望全天 event，实际 type=%s allDay=%v", c.Type, c.AllDay)
	}
	if c.StartDate == nil || c.StartDate.Format("2006-01-02") != "2026-08-21" {
		t.Errorf("“后天”应为 2026-08-21，实际 %v", c.StartDate)
	}
	if len(c.Warnings) == 0 {
		t.Error("按全天处理时应给出提示")
	}
}

func TestParseNoteStripsKeywordPrefix(t *testing.T) {
	result := parse(t, "记一下：新的定价思路可以按用量分档")

	c := result.Candidates[0]
	if c.Type != "note" {
		t.Fatalf("期望类型 note，实际 %s", c.Type)
	}
	if c.Content != "新的定价思路可以按用量分档" {
		t.Errorf("正文应剥离“记一下：”前缀，实际 %q", c.Content)
	}
}

func TestParseImportantDate(t *testing.T) {
	result := parse(t, "8月24日是妈妈生日")

	c := result.Candidates[0]
	if c.Type != "event" || c.EventKind != "important_date" {
		t.Fatalf("期望重要日，实际 type=%s kind=%s", c.Type, c.EventKind)
	}
	if !c.AllDay {
		t.Error("重要日应为全天事件")
	}
	if c.StartDate == nil || c.StartDate.Format("2006-01-02") != "2026-08-24" {
		t.Errorf("期望 2026-08-24，实际 %v", c.StartDate)
	}
}

func TestParseMultipleSegments(t *testing.T) {
	result := parse(t, "明天下午3点和张总开会；周五前完成季度报告；记一下：定价思路")

	if len(result.Candidates) != 3 {
		t.Fatalf("期望 3 个候选，实际 %d 个", len(result.Candidates))
	}
	types := []string{result.Candidates[0].Type, result.Candidates[1].Type, result.Candidates[2].Type}
	want := []string{"event", "task", "note"}
	for i := range want {
		if types[i] != want[i] {
			t.Errorf("第 %d 个候选期望 %s，实际 %s", i+1, want[i], types[i])
		}
	}
	// 同一次输入出现两个不同日期时必须交给用户选择，而不是自行取舍。
	if len(result.Conflicts) != 1 || result.Conflicts[0].Field != "date" {
		t.Errorf("期望一个日期冲突，实际 %+v", result.Conflicts)
	}
}

func TestParseTrip(t *testing.T) {
	result := parse(t, "创建行程：8月29日至31日去北京，和爸妈一起，记得带身份证")

	if len(result.Candidates) != 1 {
		t.Fatalf("期望 1 个候选，实际 %d 个", len(result.Candidates))
	}
	c := result.Candidates[0]
	if c.Type != "project" || c.ProjectKind != "trip" {
		t.Fatalf("期望行程项目，实际 type=%s kind=%s", c.Type, c.ProjectKind)
	}
	if c.Title != "北京行程" || c.Destination != "北京" {
		t.Errorf("行程标题或目的地不正确：title=%q destination=%q", c.Title, c.Destination)
	}
	if c.StartDate == nil || c.StartDate.Format("2006-01-02") != "2026-08-29" {
		t.Errorf("开始日期不正确：%v", c.StartDate)
	}
	if c.TargetDate == nil || c.TargetDate.Format("2006-01-02") != "2026-08-31" {
		t.Errorf("结束日期不正确：%v", c.TargetDate)
	}
	if c.Description != "和爸妈一起，记得带身份证" {
		t.Errorf("注意事项不正确：%q", c.Description)
	}
	if len(c.Missing) != 0 {
		t.Errorf("完整行程不应缺少字段：%v", c.Missing)
	}
}

func TestTripKeywordAloneDoesNotHijackOtherContent(t *testing.T) {
	result := parse(t, "记一下：出差前要检查报销规则")
	if len(result.Candidates) != 1 || result.Candidates[0].Type != "note" {
		t.Fatalf("普通出差笔记不应被识别成行程：%+v", result.Candidates)
	}
}

func TestParsePriority(t *testing.T) {
	if got := parse(t, "紧急处理服务器告警").Candidates[0].Priority; got != "high" {
		t.Errorf("“紧急”应为 high，实际 %s", got)
	}
	if got := parse(t, "有空整理一下书架").Candidates[0].Priority; got != "low" {
		t.Errorf("“有空”应为 low，实际 %s", got)
	}
}

func TestParseEmptyInputAsksForClarification(t *testing.T) {
	// 没有可理解的文字时不猜测内容，而是提出阻塞型追问。
	result := New()
	out, err := result.ParseCapture(context.Background(), ai.CaptureParseRequest{
		Parts:    []ai.InputPart{{ID: "cpt_1", Kind: ai.PartImage}},
		Timezone: "Asia/Shanghai",
		Now:      baseNow,
	})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if len(out.Candidates) != 0 {
		t.Error("无法理解时不应产生候选")
	}
	if len(out.Questions) != 1 || !out.Questions[0].Blocking {
		t.Errorf("应提出一个阻塞型追问，实际 %+v", out.Questions)
	}
}

func TestParseIsDeterministic(t *testing.T) {
	// 相同输入必须得到相同输出，这样下游的确认与写入逻辑可以被稳定测试。
	const text = "明天下午3点和张总开会；周五前完成季度报告"
	first := parse(t, text)
	second := parse(t, text)

	if len(first.Candidates) != len(second.Candidates) {
		t.Fatal("两次解析的候选数量不一致")
	}
	for i := range first.Candidates {
		if first.Candidates[i].Title != second.Candidates[i].Title {
			t.Errorf("第 %d 个候选标题不稳定：%q vs %q",
				i, first.Candidates[i].Title, second.Candidates[i].Title)
		}
	}
}

func TestNextWeekday(t *testing.T) {
	wednesday := time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name          string
		target        time.Weekday
		forceNextWeek bool
		want          string
	}{
		{"本周内的周五", time.Friday, false, "2026-08-21"},
		{"今天就是周三时指下一个周三", time.Wednesday, false, "2026-08-26"},
		{"下周五", time.Friday, true, "2026-08-28"},
		// 今天是周三时，“下周三”应当是 7 天后而不是 14 天后。
		{"下周三", time.Wednesday, true, "2026-08-26"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nextWeekday(wednesday, tc.target, tc.forceNextWeek).Format("2006-01-02")
			if got != tc.want {
				t.Errorf("期望 %s，实际 %s", tc.want, got)
			}
		})
	}
}
