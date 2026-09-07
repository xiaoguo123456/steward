package eval

import (
	"context"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"testing"
)

func hardeningStack(t *testing.T) *Stack {
	t.Helper()
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未配置测试数据库")
	}
	db, err := database.Open(t.Context(), cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("独立测试库连接失败：%v", err)
	}
	t.Cleanup(db.Close)
	return NewStack(db)
}
func TestEvalDetectsUnintendedUpdates(t *testing.T) {
	zero := 0
	if len(Check(Case{Expect: Expect{TasksUpdated: &zero}}, Result{TasksUpdated: 1})) == 0 {
		t.Fatal("非预期更新没有被发现")
	}
	if got := changedTasks(map[string]string{"a": "旧", "b": "保留"}, map[string]string{"a": "新", "b": "保留", "c": "新增"}); got != 1 {
		t.Fatalf("更新计数=%d", got)
	}
	if (Result{ToolSources: []string{"task:forged"}}).sourceResolvable("task:forged") {
		t.Fatal("建议自报来源不应可信")
	}
}
func TestProposalTerminalStateCommits(t *testing.T) {
	for _, kind := range []string{"expired", "stale"} {
		t.Run(kind, func(t *testing.T) {
			s := hardeningStack(t)
			ctx := t.Context()
			uid, err := s.seedUser(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer s.dropUser(context.WithoutCancel(ctx), uid)
			thread, turn, _, err := s.startTurn(ctx, uid, "评审")
			if err != nil {
				t.Fatal(err)
			}
			task, err := s.Objects.CreateTask(ctx, uid, httpapi.CreateTaskRequest{Title: "旧标题"})
			if err != nil {
				t.Fatal(err)
			}
			var proposalID string
			version := int(task.Version)
			err = s.DB.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
				if err := q.RecordToolCall(ctx, dbgen.RecordToolCallParams{ID: "atc_" + turn, UserID: uid, TurnID: turn, CallSeq: 1, CapabilityName: "objects.get", Risk: "read_only", ArgumentsHash: []byte("args"), ResultHash: []byte("result"), ResultSummary: []byte(`"读取目标"`), SourceRefs: []byte(`["task:` + task.ID + `"]`), Status: "succeeded"}); err != nil {
					return err
				}
				var e error
				proposalID, e = s.Proposals.SaveDraft(ctx, q, uid, thread, turn, ai.ProposalDraft{Type: "task_update", TargetType: "task", TargetID: task.ID, TargetExpectedVersion: &version, Command: map[string]any{"title": "新标题"}, Preview: ai.ProposalPreview{Title: "修改标题"}, SourceRefs: []string{"task:" + task.ID}})
				return e
			})
			if err != nil {
				t.Fatal(err)
			}
			err = s.DB.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
				tx, e := database.TxFrom(ctx)
				if e != nil {
					return e
				}
				if kind == "expired" {
					_, e = tx.Exec(ctx, "UPDATE action_proposals SET expires_at=now()-interval '1 second' WHERE id=$1", proposalID)
				} else {
					_, e = tx.Exec(ctx, "UPDATE tasks SET version=version+1 WHERE id=$1", task.ID)
				}
				return e
			})
			if err != nil {
				t.Fatal(err)
			}
			_, confirmErr := s.Proposals.Confirm(ctx, uid, proposalID, httpapi.ConfirmProposalRequest{ProposalVersion: 1})
			p, err := s.Proposals.Get(ctx, uid, proposalID)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("确认错误=%v；数据库状态=%s", confirmErr, p.Status)
			if confirmErr == nil || p.Status != kind {
				t.Fatal("建议终态没有提交")
			}
		})
	}
}

func TestSupersededOperationCloses(t *testing.T) {
	s := hardeningStack(t)
	ctx := t.Context()
	uid, err := s.seedUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(ctx), uid)
	thread, turn, op, err := s.startTurn(ctx, uid, "第一轮")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Assistant.CreateTurn(ctx, uid, thread, httpapi.CreateTurnRequest{Text: "第二轮"})
	if err != nil {
		t.Fatal(err)
	}
	err = s.Assistant.Respond(ctx, assistant.RespondArgs{UserID: uid, ThreadID: thread, TurnID: turn, OperationID: op, IdempotencyKey: "review:" + turn})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Assistant.MarkTurnPermanentlyFailed(ctx, assistant.RespondArgs{UserID: uid, ThreadID: thread, TurnID: turn, OperationID: op}); err != nil {
		t.Fatal(err)
	}
	err = s.DB.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
		turnRow, e := q.GetTurn(ctx, turn)
		if e != nil {
			return e
		}
		operation, e := q.GetOperation(ctx, op)
		if e != nil {
			return e
		}
		t.Logf("旧轮次=%s；旧 Operation=%s", turnRow.Status, operation.Status)
		if turnRow.Status != "superseded" || operation.Status != "cancelled" || operation.CompletedAt == nil {
			t.Fatal("被替代的 Operation 未终止")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDraftEvidenceAndEditedDateCannotBypassValidation(t *testing.T) {
	s := hardeningStack(t)
	ctx := t.Context()
	uid, err := s.seedUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(ctx), uid)
	thread, turn, _, err := s.startTurn(ctx, uid, "创建验收任务")
	if err != nil {
		t.Fatal(err)
	}
	var proposalID string
	err = s.DB.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetTurn(ctx, turn)
		if err != nil {
			return err
		}
		draft := ai.ProposalDraft{Type: "task_create", Command: map[string]any{"title": "校验任务"}, Preview: ai.ProposalPreview{Title: "校验任务"}, EditableFields: []string{"due_at"}, SourceRefs: []string{"task:forged"}}
		if _, err = s.Proposals.SaveDraft(ctx, q, uid, thread, turn, draft); errorCode(err) != "AI_SOURCE_INVALID" {
			t.Fatalf("直接存草稿应拒绝伪造来源：%v", err)
		}
		draft.SourceRefs = []string{"message:" + *row.UserMessageID}
		draft.Command["due_at"] = "无效时间"
		if _, err = s.Proposals.SaveDraft(ctx, q, uid, thread, turn, draft); errorCode(err) != "VALIDATION_FAILED" {
			t.Fatalf("直接存草稿应拒绝无效日期：%v", err)
		}
		delete(draft.Command, "due_at")
		proposalID, err = s.Proposals.SaveDraft(ctx, q, uid, thread, turn, draft)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	edits := map[string]any{"due_at": "明天下午"}
	_, err = s.Proposals.Confirm(ctx, uid, proposalID, httpapi.ConfirmProposalRequest{ProposalVersion: 1, Edits: &edits})
	if errorCode(err) != "VALIDATION_FAILED" {
		t.Fatalf("确认编辑不能绕过日期校验：%v", err)
	}
	tasks, err := s.taskSnapshot(ctx, uid)
	if err != nil || len(tasks) != 0 {
		t.Fatalf("无效编辑产生了任务：%d/%v", len(tasks), err)
	}
	proposal, err := s.Proposals.Get(ctx, uid, proposalID)
	if err != nil || proposal.Status != "pending" {
		t.Fatalf("可修正的校验错误应保留 pending：%v", err)
	}
}
