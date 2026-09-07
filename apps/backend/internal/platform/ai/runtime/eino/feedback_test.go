package eino

import (
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"strings"
	"testing"
)

func TestSchemaFeedbackIncludesPathsWithoutInputValues(t *testing.T) {
	parameters := map[string]any{"type": "object", "additionalProperties": false, "required": []string{"tasks"}, "properties": map[string]any{
		"tasks": map[string]any{"type": "array", "minItems": 2, "items": map[string]any{"type": "object", "required": []string{"title"}, "properties": map[string]any{"title": map[string]any{"type": "string"}}}},
	}}
	tools, err := newCapabilityTools(nil)
	if err != nil || len(tools) != 0 {
		t.Fatal(err)
	}
	// 复用真实工具 Schema 编译器，验证模型能看见可纠错的路径。
	capabilityTools, err := newCapabilityTools([]ai.Capability{{Name: "test", Parameters: parameters}})
	if err != nil {
		t.Fatal(err)
	}
	validator := capabilityTools[0].(*capabilityTool).validator
	for _, tc := range []struct {
		value map[string]any
		want  string
	}{
		{map[string]any{}, "$.tasks: required"},
		{map[string]any{"tasks": []any{map[string]any{}, map[string]any{"title": "合成私密值"}}}, "$.tasks[0].title: required"},
		{map[string]any{"tasks": []any{}, "合成私密键": "合成私密值"}, "minItems"},
	} {
		feedback := schemaFeedback(validator.Validate(tc.value), parameters)
		if !strings.Contains(feedback, tc.want) || strings.Contains(feedback, "合成私密") {
			t.Fatalf("字段反馈不安全或不可用：%s", feedback)
		}
	}
}

func TestSuccessfulProposalDoesNotFinishCompoundRequest(t *testing.T) {
	for _, value := range []string{"创建任务并查询日程", "先创建任务再查询", "记一个待办，顺便查今天的安排"} {
		state := &runState{req: ai.TurnRequest{UserText: value}, shortcut: true, proposals: []ai.ProposalDraft{{Type: "task_create"}}, toolCalls: []ai.ToolCallRecord{{Status: "succeeded"}}}
		if state.terminalText() != "" {
			t.Fatal("复合请求在第一项建议后被截断：", value)
		}
	}
}
