package eval

import (
	"context"
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

type outcomeProbeEngine struct {
	ai.OrchestrationEngine
	failNext    bool
	replyText   string
	lastRequest ai.TurnRequest
}

func (e *outcomeProbeEngine) RunTurn(ctx context.Context, req ai.TurnRequest) (ai.TurnResult, error) {
	e.lastRequest = req
	if e.failNext {
		e.failNext = false
		return ai.TurnResult{}, ai.ErrProviderUnavailable
	}
	if e.OrchestrationEngine != nil {
		return e.OrchestrationEngine.RunTurn(ctx, req)
	}
	if e.replyText != "" {
		return ai.TurnResult{Text: e.replyText, Mode: "conversation"}, nil
	}
	return ai.TurnResult{Text: "你好。", Mode: "conversation"}, nil
}
func (*outcomeProbeEngine) Type() string    { return "outcome-test" }
func (*outcomeProbeEngine) Version() string { return "v1" }

func runOutcomeTurn(t *testing.T, s *Stack, uid, threadID, text string) (assistant.TurnAccepted, Result) {
	t.Helper()
	a, err := s.Assistant.CreateTurn(t.Context(), uid, threadID, httpapi.CreateTurnRequest{Text: text})
	if err != nil {
		t.Fatal(err)
	}
	err = s.Assistant.Respond(t.Context(), assistant.RespondArgs{SchemaVersion: 1, UserID: uid, ThreadID: threadID, TurnID: a.TurnID, OperationID: a.OperationID, IdempotencyKey: "outcome:" + a.TurnID})
	if err != nil {
		t.Fatal(err)
	}
	var result Result
	if err := s.collect(t.Context(), uid, a.TurnID, &result); err != nil {
		t.Fatal(err)
	}
	return a, result
}

func TestHistoryOutcomesReachNextTurn(t *testing.T) {
	s := hardeningStack(t)
	uid, err := s.seedUser(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(t.Context()), uid)
	engine := &outcomeProbeEngine{failNext: true}
	s.Assistant = assistant.New(s.DB, engine, s.Registry, s.Users, noopEnqueuer{}, s.Proposals, s.Memory, nil, nil)
	thread, err := s.Assistant.CreateThread(t.Context(), uid, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	first, result := runOutcomeTurn(t, s, uid, thread.ID, "你好，继续下一件事")
	if !result.TurnFailed {
		t.Fatal("故障注入没有失败")
	}
	_, result = runOutcomeTurn(t, s, uid, thread.ID, "你好")
	if result.TurnFailed {
		t.Fatal("上一轮失败阻塞后续轮次")
	}
	found := false
	for _, message := range engine.lastRequest.History {
		if message.Role == ai.RoleSystem && strings.Contains(message.Content, "回复失败") {
			found = true
		}
	}
	if !found {
		t.Fatal("真实数据库中的失败状态没有到达编排上下文")
	}
	// 回执必须按当前用户及 Thread 隔离，不能从另一个账号借到完成证据。
	other, err := s.seedUser(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(t.Context()), other)
	var messageID string
	err = s.DB.InTx(t.Context(), uid, func(ctx context.Context, q *dbgen.Queries) error {
		turn, err := q.GetTurn(ctx, first.TurnID)
		if err != nil {
			return err
		}
		messageID = *turn.UserMessageID
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{uid, other} {
		err = s.DB.InTx(t.Context(), owner, func(ctx context.Context, q *dbgen.Queries) error {
			rows, err := q.ListHistoryTurnOutcomes(ctx, dbgen.ListHistoryTurnOutcomesParams{ThreadID: thread.ID, MessageIds: []string{messageID}})
			if err != nil {
				return err
			}
			if owner == uid && (len(rows) != 1 || rows[0].Status != "failed_retryable") {
				t.Fatal("本人失败状态读取不正确")
			}
			if owner != uid && len(rows) != 0 {
				t.Fatal("历史回执跨用户泄露")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestHistoryProposalStateIsReadFresh(t *testing.T) {
	s := hardeningStack(t)
	uid, err := s.seedUser(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(t.Context()), uid)
	engine := &outcomeProbeEngine{}
	s.Assistant = assistant.New(s.DB, engine, s.Registry, s.Users, noopEnqueuer{}, s.Proposals, s.Memory, nil, nil)
	thread, err := s.Assistant.CreateThread(t.Context(), uid, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := runOutcomeTurn(t, s, uid, thread.ID, "本轮状态测试")
	for _, state := range []string{"pending", "executed", "rejected", "expired", "failed", "stale", "superseded"} {
		err = s.DB.InTx(t.Context(), uid, func(ctx context.Context, q *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `INSERT INTO action_proposals (id,user_id,thread_id,turn_id,proposal_type,command,status,expires_at) VALUES ($1,$2,$3,$4,'task_create','{}',$5,now()+interval '1 hour') ON CONFLICT(id) DO UPDATE SET status=excluded.status`, "proposal_"+first.TurnID, uid, thread.ID, first.TurnID, state)
			if err != nil {
				return err
			}
			turn, err := q.GetTurn(ctx, first.TurnID)
			if err != nil {
				return err
			}
			rows, err := q.ListHistoryTurnOutcomes(ctx, dbgen.ListHistoryTurnOutcomesParams{ThreadID: thread.ID, MessageIds: []string{*turn.UserMessageID}})
			if err != nil {
				return err
			}
			if len(rows) != 1 || rows[0].ProposalCount != 1 || (rows[0].PendingCount == 1) != (state == "pending") || (rows[0].ExecutedCount == 1) != (state == "executed") {
				t.Fatal("回执没有读取建议的最新状态")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
