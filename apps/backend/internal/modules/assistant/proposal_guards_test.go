package assistant

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

type duplicateTaskQueries struct {
	taskQueriesStub
	rows []dbgen.Task
}

func (s *duplicateTaskQueries) ListTasks(context.Context, string, objects.TaskFilter) ([]dbgen.Task, error) {
	return s.rows, nil
}

func TestTargetGuardRequiresSelectionAndChecksCondition(t *testing.T) {
	rows := []dbgen.Task{{ID: "tsk_a", Title: "周报", Status: "todo", Version: 1}, {ID: "tsk_b", Title: "周报", Status: "todo", Version: 1}}
	deps := CapabilityDeps{Tasks: &duplicateTaskQueries{rows: rows}}
	cc := ai.CapabilityContext{UserID: "usr_me", UserTexts: []string{"把周报改到明天"}}
	var question *ai.ClarificationError
	err := deps.guardTaskTarget(t.Context(), cc, map[string]any{}, rows[0])
	if !errors.As(err, &question) || len(question.Choices) != 2 {
		t.Fatal("同名目标未返回真实选择")
	}
	cc.EntryResourceID = "tsk_a"
	cc.SelectedVersion = 1
	if err := deps.guardTaskTarget(t.Context(), cc, map[string]any{}, rows[0]); err != nil {
		t.Fatal("有效选择被拒绝：", err)
	}
	cc.UserTexts = []string{"如果周报已经完成，就改到明天；否则不要动"}
	if err := deps.guardTaskTarget(t.Context(), cc, map[string]any{"required_status": "done"}, rows[0]); err == nil {
		t.Fatal("不成立的状态条件未阻断")
	}
	cc.UserTexts = []string{"如果明天下雨，就改到明天"}
	if err := deps.guardTaskTarget(t.Context(), cc, map[string]any{"required_status": "todo"}, rows[0]); err == nil {
		t.Fatal("复杂条件被伪装为状态条件")
	}
}

func TestTimeEvidenceRejectsInventedValuesAndUsesUserFragments(t *testing.T) {
	cc := ai.CapabilityContext{Timezone: "Asia/Shanghai", Now: time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC), UserTexts: []string{"安排明天下午评审", "三点到四点"}}
	args := map[string]any{"start_at": "2026-09-09T14:00:00+08:00", "time_evidence": map[string]any{"start_at": map[string]any{"date_text": "明天", "time_text": "三点", "period_text": "下午"}}}
	if err := validateTimeEvidence(cc, args); err != nil {
		t.Fatal(err)
	}
	if args["start_at"] != "2026-09-08T15:00:00+08:00" {
		t.Fatal("仍采用模型自选日期")
	}
	args["time_evidence"] = map[string]any{"start_at": map[string]any{"date_text": "后天", "time_text": "三点", "period_text": "下午"}}
	if err := validateTimeEvidence(cc, args); err == nil {
		t.Fatal("未经用户表达的日期来源被接受")
	}
}

func TestRecordingDeclineDoesNotSwallowQueriesOrAffirmativeNegation(t *testing.T) {
	for _, value := range []string{"今天不想跑步，不要记成偏好", "不用保存，我只是随口聊聊"} {
		if !declinesRecording(value) {
			t.Fatal("明确不记录没有结束")
		}
	}
	for _, value := range []string{"不要忘记买牛奶", "帮我查询今天日程，不用记录", "不要建任务，记成笔记", "笔记里写着“不要保存”"} {
		if declinesRecording(value) {
			t.Fatal("查询或引用被误当作退出")
		}
	}
}

func TestTimeEvidenceAnchorsToOriginalMessageAcrossMidnight(t *testing.T) {
	original := time.Date(2026, 9, 7, 15, 50, 0, 0, time.UTC)
	cc := ai.CapabilityContext{Timezone: "Asia/Shanghai", Now: original.Add(time.Hour), UserTexts: []string{"明天下午开会", "三点"}, UserSources: []ai.UserTextSource{{Text: "明天下午开会", CreatedAt: original}, {Text: "三点", CreatedAt: original.Add(time.Hour)}}}
	args := map[string]any{"start_at": "2026-09-09T15:00:00+08:00", "time_evidence": map[string]any{"start_at": map[string]any{"date_text": "明天", "time_text": "三点", "period_text": "下午"}}}
	if err := validateTimeEvidence(cc, args); err != nil {
		t.Fatal(err)
	}
	if args["start_at"] != "2026-09-08T15:00:00+08:00" {
		t.Fatal("跨午夜将原意再顺延了一天")
	}
}

func TestRecommendedTimeRequiresExplicitRequest(t *testing.T) {
	now := time.Now()
	cc := ai.CapabilityContext{Now: now, UserTexts: []string{"帮我推荐合适时段"}}
	args := map[string]any{"scheduled_start_at": now.Add(time.Hour).Format(time.RFC3339), "time_evidence": map[string]any{"scheduled_start_at": map[string]any{"suggestion_request": "推荐合适时段"}}}
	if err := validateTimeEvidence(cc, args); err != nil {
		t.Fatal("推荐时间路径被阻断：", err)
	}
	cc.UserTexts = []string{"安排明天下午开会"}
	if err := validateTimeEvidence(cc, args); err == nil {
		t.Fatal("普通安排请求被当成允许猜时刻")
	}
}

func TestClockRangeUsesSharedPeriodWithoutRepeatedQuestion(t *testing.T) {
	cc := ai.CapabilityContext{Timezone: "Asia/Shanghai", Now: time.Now(), UserTexts: []string{"明天晚上读书会", "晚上八点到九点"}}
	args := map[string]any{"start_at": "2026-09-08T20:00:00+08:00", "end_at": "2026-09-08T21:00:00+08:00", "time_evidence": map[string]any{
		"start_at": map[string]any{"date_text": "明天", "time_text": "晚上八点到九点"},
		"end_at":   map[string]any{"date_text": "明天", "time_text": "八点到九点"},
	}}
	if err := validateTimeEvidence(cc, args); err != nil {
		t.Fatal("没有继承范围中的明确时段：", err)
	}
	if !strings.Contains(text(args["start_at"]), "T20:00:00") || !strings.Contains(text(args["end_at"]), "T21:00:00") {
		t.Fatal("范围端点解析错误")
	}
}
