package eval

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// 用脚本只控制模型选择，数据库、版本、来源、确认与事务都是真实实现。
func TestPendingProposalRevisionAndWithdrawal(t *testing.T) {
	s := hardeningStack(t)
	ctx := t.Context()
	uid, err := s.seedUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(ctx), uid)
	thread, err := s.Assistant.CreateThread(ctx, uid, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	run := func(text, name string, args map[string]any) []dbgen.ActionProposal {
		t.Helper()
		accepted, err := s.Assistant.CreateTurn(ctx, uid, thread.ID, httpapi.CreateTurnRequest{Text: text})
		if err != nil {
			t.Fatal(err)
		}
		if name == "tasks.propose_create" {
			args["source_refs"] = []string{"message:" + accepted.MessageID}
		}
		raw, _ := json.Marshal(args)
		s.provider.reset([]ai.CompletionResult{{ToolCalls: []ai.ToolCall{{ID: "call", Name: name, Arguments: string(raw)}}}})
		if err := s.Assistant.Respond(ctx, assistant.RespondArgs{UserID: uid, ThreadID: thread.ID, TurnID: accepted.TurnID, OperationID: accepted.OperationID, IdempotencyKey: "interaction:" + accepted.TurnID}); err != nil {
			t.Fatal(err)
		}
		rows, err := s.Proposals.List(ctx, uid, []string{"pending"}, nil, nil, 20)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	rows := run("帮我记买牛奶", "tasks.propose_create", map[string]any{"title": "买牛奶", "reason": "用户明确要求"})
	if len(rows) != 1 {
		t.Fatal("初始建议未生成")
	}
	old := rows[0]
	rows = run("改成买燕麦奶", "tasks.propose_create", map[string]any{"title": "买燕麦奶", "reason": "用户修订", "replaces_proposal_id": old.ID})
	if len(rows) != 1 || rows[0].ID == old.ID {
		t.Fatal("修订没有原子替换")
	}
	oldState, err := s.Proposals.Get(ctx, uid, old.ID)
	if err != nil || oldState.Status != "superseded" || oldState.Version != old.Version+1 {
		t.Fatal("旧建议未失效或未推进版本")
	}
	if _, err := s.Proposals.Confirm(ctx, uid, old.ID, httpapi.ConfirmProposalRequest{ProposalVersion: int(old.Version)}); err == nil {
		t.Fatal("旧卡片仍可确认")
	}
	current := rows[0]
	rows = run("算了，不要了", "assistant.dismiss_proposal", map[string]any{"proposal_id": current.ID})
	if len(rows) != 0 {
		t.Fatal("撤回后仍有待确认建议")
	}
	currentState, err := s.Proposals.Get(ctx, uid, current.ID)
	if err != nil || currentState.Status != "rejected" {
		t.Fatal("取消未持久化")
	}
	if _, err := s.Proposals.Confirm(ctx, uid, current.ID, httpapi.ConfirmProposalRequest{ProposalVersion: int(current.Version)}); err == nil {
		t.Fatal("取消后仍能执行")
	}
	tasks, err := s.taskSnapshot(ctx, uid)
	if err != nil || len(tasks) != 0 {
		t.Fatal("未确认时写入正式任务")
	}
	messages, _, err := s.Assistant.ListMessages(ctx, uid, thread.ID, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	mapped := assistant.MapMessage(messages[0], nil)
	if mapped.Interaction == nil || mapped.Interaction.Outcome != "cancelled" {
		t.Fatal("回复没有真实取消结果")
	}
}

func TestClarificationSelectionExpiresOnTopicChange(t *testing.T) {
	s := hardeningStack(t)
	ctx := t.Context()
	uid, err := s.seedUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(ctx), uid)
	thread, err := s.Assistant.CreateThread(ctx, uid, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	var message dbgen.AssistantMessage
	err = s.DB.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
		seq, err := q.AdvanceThreadSeq(ctx, dbgen.AdvanceThreadSeqParams{ID: thread.ID, MessageDelta: 1})
		if err != nil {
			return err
		}
		message, err = q.CreateMessage(ctx, dbgen.CreateMessageParams{ID: "amsg_" + thread.ID, UserID: uid, ThreadID: thread.ID, MessageSeq: seq.LastMessageSeq, Role: "assistant", Status: "completed", Content: "请选择任务"})
		if err != nil {
			return err
		}
		return q.SetMessageInteraction(ctx, dbgen.SetMessageInteractionParams{ID: message.ID, Interaction: []byte(`{"outcome":"clarification","clarification":{"question":"请选择任务","choices":[{"id":"choice-a","label":"周报","resource_type":"task","resource_id":"tsk_selected","version":1}]}}`)})
	})
	if err != nil {
		t.Fatal(err)
	}
	choice := "choice-a"
	if _, err := s.Assistant.CreateTurn(ctx, uid, thread.ID, httpapi.CreateTurnRequest{Text: "周报", ChoiceId: &choice, ClarificationMessageId: &message.ID}); err != nil {
		t.Fatal("当前选项被错误拒绝：", err)
	}
	if _, err := s.Assistant.CreateTurn(ctx, uid, thread.ID, httpapi.CreateTurnRequest{Text: "周报", ChoiceId: &choice, ClarificationMessageId: &message.ID}); err == nil {
		t.Fatal("旧问题重复点击没有失效")
	}
}
