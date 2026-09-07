package eval

import (
	"context"
	"encoding/json"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/openai"
	einoruntime "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/eino"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"
)

// 仅在显式开启时调用真实 Provider，每例使用独立用户和虚构资料并自动清理。
func TestLiveAssistantAcceptance(t *testing.T) {
	if os.Getenv("STEWARD_AI_LIVE_ACCEPTANCE") != "1" {
		t.Skip("需显式启用真实模型验收")
	}
	for _, tc := range []struct {
		name, text string
		fixtures   Fixtures
		confirm    bool
	}{
		{"空任务查询", "我现在有哪些未完成任务？", Fixtures{}, false},
		{"任务查询", "我现在有哪些未完成任务？", Fixtures{Tasks: []FixtureTask{{Title: "评审测试：周报"}, {Title: "评审测试：采购文具"}}}, false},
		{"新用户创建任务", "帮我记一个任务：明天下午三点前交评审报告。请准备待确认建议。", Fixtures{}, true},
		{"任务改期", "把评审测试周报的截止时间改到明天下午三点，请准备待确认建议。", Fixtures{Tasks: []FixtureTask{{Title: "评审测试周报"}}}, true},
		{"任务拆分", "把准备评审材料拆成三个子任务，请生成待确认建议。", Fixtures{Tasks: []FixtureTask{{Title: "准备评审材料"}}}, true},
		{"创建日程", "明天上午十点到十一点评审会议，帮我准备日程建议。", Fixtures{}, true},
		{"记录偏好", "请记住我一般晚上七点以后运动，准备一条待确认的记忆建议。", Fixtures{}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := hardeningStack(t)
			p, err := openai.New(openai.Config{BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"), ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), ChatModel: os.Getenv("STEWARD_AI_MODEL_CHAT"), ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 1500, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
			if err != nil {
				t.Fatal(err)
			}
			measured := &acceptanceMeasuredProvider{Provider: p, t: t}
			s.Assistant = assistant.New(s.DB, acceptanceTracingEngine{OrchestrationEngine: einoruntime.New(measured, nil), t: t}, s.Registry, s.Users, noopEnqueuer{}, s.Proposals, s.Memory, nil, nil)
			r, err := s.Run(t.Context(), Case{UserText: tc.text, Fixtures: tc.fixtures, ConfirmFirstProposal: tc.confirm})
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(map[string]any{"tools": r.ExecutedTools, "denied": r.DeniedTools, "proposals": len(r.Proposals), "confirmed": r.ConfirmDone, "confirm_error": r.ConfirmErr, "turn_failed": r.TurnFailed, "answer": r.Answer, "tasks_created": r.TasksCreated})
			t.Log(string(raw))
			if r.TurnFailed {
				t.Error("真实模型轮次失败")
			}
			if tc.name == "任务查询" && (len(r.ExecutedTools) == 0 || !strings.Contains(r.Answer, "周报") || !strings.Contains(r.Answer, "采购文具")) {
				t.Error("未查询或未回答已有任务")
			}
			if tc.confirm && !r.ConfirmDone {
				t.Error("未完成建议与确认闭环")
			}
		})
	}
}

type acceptanceTracingEngine struct {
	ai.OrchestrationEngine
	t *testing.T
}

func (e acceptanceTracingEngine) RunTurn(ctx context.Context, req ai.TurnRequest) (ai.TurnResult, error) {
	started := time.Now()
	r, err := e.OrchestrationEngine.RunTurn(ctx, req)
	e.t.Logf("编排耗时：总计=%dms，Provider 合计=%dms", time.Since(started).Milliseconds(), r.Usage.LatencyMS)
	for _, call := range r.ToolCalls {
		e.t.Logf("工具轨迹：%s %s %dms", call.Name, call.Status, call.DurationMS)
	}
	return r, err
}

// 保留真实流式路径，仅记录每次模型往返的耗时和形状，不记录正文、参数或凭据。
type acceptanceMeasuredProvider struct {
	*openai.Provider
	t     *testing.T
	round int
}

func (p *acceptanceMeasuredProvider) CompleteStream(ctx context.Context, req ai.CompletionRequest, onDelta func(string)) (ai.CompletionResult, error) {
	p.round++
	started := time.Now()
	r, err := p.Provider.CompleteStream(ctx, req, onDelta)
	p.t.Logf("模型往返：序号=%d，耗时=%dms，工具申请=%d，输入token=%d，输出token=%d，成功=%t", p.round, time.Since(started).Milliseconds(), len(r.ToolCalls), r.Usage.InputTokens, r.Usage.OutputTokens, err == nil)
	return r, err
}
