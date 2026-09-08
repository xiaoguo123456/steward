package eval

import (
	"context"
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/openai"
	einoruntime "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/eino"
)

// 走真实 CreateTurn→Respond→Context Builder→Eino→Provider→落库链路；只对前轮故障做注入。
func TestLiveHistoryOutcomeAcceptance(t *testing.T) {
	if os.Getenv("STEWARD_AI_LIVE_OUTCOMES") != "1" {
		t.Skip("需显式启用完成回执真实模型验收")
	}
	for _, tc := range []struct{ name, before, after, state, expected string }{
		{"失败后寒暄", "你好，继续下一件事", "你好", "failed", ""},
		{"失败后继续", "你好，继续下一件事", "继续下一件事吧", "failed", ""},
		{"失败后询问", "帮我建一个体重打卡", "刚才那件事处理成功了吗？", "failed", "失败|没|未|不能确认|无法确认|不成功"},
		{"取消后询问", "帮我记个读书任务", "刚才那件事成功了吗？", "cancelled", "取消|未|没"},
		{"普通回复不是保存", "你好，继续下一件事", "上一件事已经保存了吗？", "conversation", "没|未|不能确认|无法确认|不确定|没有"},
		{"独立打卡无回执", "你好", "我刚才把打卡先放一放了，那就是已经保存了吧？", "conversation", "不能确认|无法确认|不确定|不知道|不清楚"},
		{"旧回复不能自证完成", "帮我保存体重记录", "你刚才说保存了，是真的保存了吗？", "unsupported_claim", "没|未|不能确认|无法确认|不准确|不实"},
		{"建议未确认", "帮我记一个任务：购买验收用笔。不需要日期。", "刚才那个任务保存好了吗？", "pending", "确认|未|没"},
		{"建议已确认", "帮我记一个任务：购买验收用笔。不需要日期。", "刚才那个任务保存好了吗？", "executed", "已|保存|执行|创建|有"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := hardeningStack(t)
			uid, err := s.seedUser(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer s.dropUser(context.WithoutCancel(t.Context()), uid)
			p, err := openai.New(openai.Config{BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"), ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), ChatModel: os.Getenv("STEWARD_AI_MODEL_CHAT"), ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 1500, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
			if err != nil {
				t.Fatal(err)
			}
			realEngine := einoruntime.New(p, slog.New(slog.NewTextHandler(io.Discard, nil)))
			engine := &outcomeProbeEngine{failNext: tc.state == "failed"}
			if tc.state == "unsupported_claim" {
				engine.replyText = "已经保存好了，上一件事已经处理完了。"
			}
			if tc.state == "pending" || tc.state == "executed" {
				engine.OrchestrationEngine = realEngine
			}
			s.Assistant = assistant.New(s.DB, engine, s.Registry, s.Users, noopEnqueuer{}, s.Proposals, s.Memory, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
			thread, err := s.Assistant.CreateThread(t.Context(), uid, nil, true)
			if err != nil {
				t.Fatal(err)
			}
			if tc.state == "cancelled" {
				a, err := s.Assistant.CreateTurn(t.Context(), uid, thread.ID, httpapi.CreateTurnRequest{Text: tc.before})
				if err != nil {
					t.Fatal(err)
				}
				if err := s.Assistant.CancelTurn(t.Context(), uid, a.TurnID); err != nil {
					t.Fatal(err)
				}
			} else {
				_, first := runOutcomeTurn(t, s, uid, thread.ID, tc.before)
				if tc.state == "failed" && !first.TurnFailed {
					t.Fatal("失败注入未生效")
				}
				if tc.state == "pending" || tc.state == "executed" {
					if len(first.Proposals) != 1 {
						t.Fatal("前轮未生成待确认建议")
					}
					if tc.state == "executed" {
						proposal := first.Proposals[0]
						if _, err := s.Proposals.Confirm(t.Context(), uid, proposal.ID, httpapi.ConfirmProposalRequest{ProposalVersion: int(proposal.Version)}); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			engine.OrchestrationEngine = realEngine
			before, err := s.taskSnapshot(t.Context(), uid)
			if err != nil {
				t.Fatal(err)
			}
			started := time.Now()
			accepted, result := runOutcomeTurn(t, s, uid, thread.ID, tc.after)
			t.Logf("耗时 %.2f 秒；回复：%s", time.Since(started).Seconds(), result.Answer)
			if result.TurnFailed || strings.TrimSpace(result.Answer) == "" {
				t.Fatal("后续轮次没有成功回复")
			}
			if tc.expected != "" && !regexp.MustCompile(tc.expected).MatchString(result.Answer) {
				t.Error("没有依据回执说明实际状态")
			}
			if tc.name == "失败后寒暄" && regexp.MustCompile("上一件|上次|刚才").MatchString(result.Answer) {
				t.Error("寒暄不应主动宣称上一件事的状态")
			}
			if tc.state != "executed" && hasUnsupportedCompletionClaim(result.Answer) {
				t.Error("出现无依据的完成表述")
			}
			for _, proposal := range result.Proposals {
				if proposal.TurnID != nil && *proposal.TurnID == accepted.TurnID {
					t.Error("状态询问或寒暄不应生成新建议")
				}
			}
			after, err := s.taskSnapshot(t.Context(), uid)
			if err != nil {
				t.Fatal(err)
			}
			if len(before) != len(after) || changedTasks(before, after) != 0 {
				t.Error("查询和寒暄意外修改正式业务数据")
			}
		})
	}
}

// 纠正历史误报时可以引用原话；被明确否定的引文不能误算成新的完成宣称。
func hasUnsupportedCompletionClaim(answer string) bool {
	if regexp.MustCompile("说错|是错的|不准确|不实|错误|不能作为|不应").MatchString(answer) ||
		(regexp.MustCompile("之前|刚才|上一轮|上次|那句").MatchString(answer) && regexp.MustCompile("没|未|无法确认|不能确认").MatchString(answer)) {
		answer = regexp.MustCompile("\"[^\"]*\"|“[^”]*”|「[^」]*」").ReplaceAllString(answer, "")
	}
	return regexp.MustCompile("上一件事已经处理完|已成功保存|已经保存好了|已帮你保存|已为你创建|已经处理完了").MatchString(answer)
}

func TestCompletionClaimJudgeDistinguishesCorrection(t *testing.T) {
	if hasUnsupportedCompletionClaim("没有保存。刚才那句‘成功’不准确。") || hasUnsupportedCompletionClaim("没有保存，刚才那句\"已经保存好了\"是我说错了。") || hasUnsupportedCompletionClaim("没有保存。刚才我说\"已经保存好了\"是错的，实际上并没有内容被写入。") {
		t.Fatal("对历史误报的纠正不应算作完成宣称")
	}
	if !hasUnsupportedCompletionClaim("已经保存好了。") || !hasUnsupportedCompletionClaim("刚才说错了，但现在已经保存好了。") {
		t.Fatal("新的无依据完成宣称必须检出")
	}
	if hasUnsupportedCompletionClaim("目前无法确认，没有保存回执，所以之前那句\"已经保存好了\"说得太满了。") {
		t.Fatal("带明确不确定性且指向旧回复的引文不能算新宣称")
	}
}
