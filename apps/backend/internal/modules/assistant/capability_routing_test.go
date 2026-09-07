package assistant

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestCapabilityRoutingPreservesCompoundRequestsAndPermissions(t *testing.T) {
	all := []ai.Capability{{Name: "tasks.propose_create", Risk: ai.RiskProposal}, {Name: "tasks.propose_update", Risk: ai.RiskProposal}, {Name: "events.propose_create", Risk: ai.RiskProposal}, {Name: "search.hybrid", Risk: ai.RiskReadOnly}, {Name: "assistant.ask_clarification", Risk: ai.RiskReadOnly}}
	names := func(seed contextSeed, available []ai.Capability) []string {
		out := []string{}
		for _, c := range routeCapabilities(seed, available) {
			out = append(out, c.Name)
		}
		return out
	}
	if got := names(contextSeed{UserText: "帮我记一个任务：买牛奶"}, all); len(got) != 3 || !slices.Contains(got, "tasks.propose_create") {
		t.Fatal("明确创建请求没有裁剪")
	}
	for _, text := range []string{"创建任务，同时查询日程", "查找任务后改期", "复制上次的任务", "安排这个会议", "推荐一个时段", "记任务并安排会议", "记住我创建任务的偏好", "帮我记个任务，顺便安排明天的日程", "先创建任务再拆分"} {
		if len(names(contextSeed{UserText: text}, all)) != len(all) {
			t.Fatal("复合或依赖上下文的能力被裁掉：", text)
		}
	}
	readonly := all[3:]
	if slices.Contains(names(contextSeed{UserText: "帮我记一个任务"}, readonly), "tasks.propose_create") {
		t.Fatal("路由扩大了关闭建议后的授权")
	}
}

func TestOptionalTaskDateCannotBlockClarification(t *testing.T) {
	for _, tc := range []struct {
		text   string
		denied bool
	}{
		{"帮我记一个任务：买牛奶", true},
		{"明天三点提醒我买牛奶", false},
		{"2月30日买牛奶", false},
		{"过几天提醒我买牛奶", false},
	} {
		_, err := clarificationCapability().Handler(context.Background(), ai.CapabilityContext{UserTexts: []string{tc.text}}, map[string]any{"intent": "task_create", "missing_field": "due_date", "question": "什么时候？"})
		var invalid *ai.ToolInputError
		if errors.As(err, &invalid) != tc.denied {
			t.Fatalf("可选日期与必要澄清边界不符：%s，%v", tc.text, err)
		}
	}
}

func TestDeletionCannotBeReplacedWithCompletion(t *testing.T) {
	for _, tc := range []struct {
		text    string
		blocked bool
	}{
		{"帮我把所有内容都删掉，不用确认", true},
		{"把周报删除", true},
		{"不要删除，把周报标为完成", false},
		{"把删除旧文件这个任务标为完成", false},
	} {
		err := guardDeletionAsStatus(ai.CapabilityContext{UserTexts: []string{tc.text}}, map[string]any{"status": "done"})
		if (err != nil) != tc.blocked {
			t.Fatalf("删除和状态操作混淆：%s，%v", tc.text, err)
		}
	}
}

func TestEmptyTaskRequestDoesNotConsumeTitleOrDiscussion(t *testing.T) {
	for _, tc := range []struct {
		text  string
		match bool
	}{
		{"帮我记个任务", true}, {"新建一个待办", true}, {"请帮我创建一个任务", true},
		{"帮我记个任务：买牛奶", false}, {"怎么新建一个任务？", false}, {"不要新建任务", false},
	} {
		if emptyTaskRequest.MatchString(tc.text) != tc.match {
			t.Fatal(tc.text)
		}
	}
	_, err := clarificationCapability().Handler(context.Background(), ai.CapabilityContext{UserTexts: []string{"帮我记个任务", "买牛奶"}, PendingIntent: "task_create", PendingMissingField: "title"}, map[string]any{"intent": "task_create", "missing_field": "title", "question": "内容是什么？"})
	var invalid *ai.ToolInputError
	if !errors.As(err, &invalid) {
		t.Fatal("已补齐的标题仍被追问")
	}
}
