package assistant

import (
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestHistoryPreservesFailedOutcomeInsteadOfMessageDeliveryState(t *testing.T) {
	current := "current"
	previous := "previous"
	messages := []dbgen.AssistantMessage{
		{ID: current, Role: "user", Content: "你好", Status: "completed"},
		{ID: previous, Role: "user", Content: "继续下一件事", Status: "completed"},
	}
	text, history := splitHistory(messages, &current, []dbgen.ListHistoryTurnOutcomesRow{{UserMessageID: &previous, Status: "failed_retryable"}})
	if text != "你好" || len(history) != 2 || history[0].Content != "继续下一件事" || history[1].Role != ai.RoleSystem || !strings.Contains(history[1].Content, "回复失败") {
		t.Fatal("失败状态应随原消息传给模型，当前消息不能重复进历史")
	}
	_, unknown := splitHistory(messages, &current, nil)
	if !strings.Contains(unknown[1].Content, "状态未知") || strings.Contains(unknown[1].Content, "共 0") {
		t.Fatal("没有回执不能推定零建议或处理成功")
	}
}

func TestHistoryOutcomeDistinguishesReplyProposalAndExecution(t *testing.T) {
	for _, tc := range []struct{ status, want string }{
		{"failed_retryable", "回复失败"}, {"failed_permanent", "回复失败"},
		{"cancelled", "回复已取消"}, {"superseded", "被后续请求替代"},
		{"queued", "回复尚未完成"}, {"running", "回复尚未完成"},
		{"succeeded", "不代表业务内容已保存"},
	} {
		t.Run(tc.status, func(t *testing.T) {
			if !strings.Contains(historyOutcomeReceipt(dbgen.ListHistoryTurnOutcomesRow{Status: tc.status}), tc.want) {
				t.Fatal("轮次结果没有正确区分")
			}
		})
	}
	partial := historyOutcomeReceipt(dbgen.ListHistoryTurnOutcomesRow{Status: "succeeded", ProposalCount: 2, PendingCount: 1, ExecutedCount: 1})
	if !strings.Contains(partial, "1 项待确认，1 项有执行历史") || !strings.Contains(partial, "可能已修改或撤销") {
		t.Fatal("部分执行不能变成整件已完成或当前状态的证据")
	}
}
