package conformancetest

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func runValidation(t *testing.T, factory Factory) {
	t.Run("参数按完整 Schema 校验后才调用能力", func(t *testing.T) {
		for _, arguments := range []string{`{}`, `{"count":"1"}`, `{"count":0}`, `{"count":3}`, `{"count":1,"extra":true}`} {
			t.Run(arguments, func(t *testing.T) {
				calls := 0
				capability := countingCapability("validated", &calls)
				capability.Parameters = map[string]any{
					"type": "object", "additionalProperties": false, "required": []string{"count"},
					"properties": map[string]any{"count": map[string]any{"type": "integer", "minimum": 1, "maximum": 2}},
				}
				provider := &scriptedProvider{steps: []ai.CompletionResult{
					{ToolCalls: []ai.ToolCall{{ID: "c1", Name: "validated", Arguments: arguments}}}, {Content: "请修改参数"},
				}}
				result, err := factory(provider, quietLogger()).RunTurn(t.Context(), request([]ai.Capability{capability}))
				if err != nil || calls != 0 || len(result.ToolCalls) != 1 || result.ToolCalls[0].ErrorCode != "AI_TOOL_INPUT_INVALID" {
					t.Fatalf("无效参数穿过校验：calls=%d result=%+v err=%v", calls, result, err)
				}
			})
		}
	})
	t.Run("建议必须引用本轮权威证据", func(t *testing.T) {
		for _, tc := range []struct {
			name, source, target string
			read, allowed        bool
		}{
			{"正式消息", "message:amsg_contract", "", false, true},
			{"伪造消息", "message:current", "", false, false},
			{"未读取对象", "task:tsk_1", "tsk_1", false, false},
			{"已读取目标", "task:tsk_1", "tsk_1", true, true},
			{"目标引用不匹配", "message:amsg_contract", "tsk_1", true, false},
		} {
			t.Run(tc.name, func(t *testing.T) {
				calls := 0
				capabilities := []ai.Capability{countingCapability("tasks.search", &calls), {
					Name: "propose", Risk: ai.RiskProposal, Timeout: time.Second, MaxResultBytes: 1024,
					Handler: func(context.Context, ai.CapabilityContext, map[string]any) (ai.CapabilityResult, error) {
						return ai.CapabilityResult{Content: "建议", SourceRefs: []string{tc.source}, Proposals: []ai.ProposalDraft{{
							Type: "task_update", TargetType: "task", TargetID: tc.target, SourceRefs: []string{tc.source},
						}}}, nil
					},
				}}
				steps := []ai.CompletionResult{}
				if tc.read {
					steps = append(steps, ai.CompletionResult{ToolCalls: []ai.ToolCall{{ID: "r", Name: "tasks.search", Arguments: `{}`}}})
				}
				steps = append(steps, ai.CompletionResult{ToolCalls: []ai.ToolCall{{ID: "p", Name: "propose", Arguments: `{}`}}}, ai.CompletionResult{Content: "完成"})
				result, err := factory(&scriptedProvider{steps: steps}, quietLogger()).RunTurn(t.Context(), request(capabilities))
				if err != nil || (len(result.Proposals) == 1) != tc.allowed {
					t.Fatalf("来源边界异常：result=%+v err=%v", result, err)
				}
				if !tc.allowed && result.ToolCalls[len(result.ToolCalls)-1].ErrorCode != "AI_SOURCE_INVALID" {
					t.Fatal("缺少来源拒绝审计")
				}
			})
		}
	})
}
