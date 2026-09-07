package eval

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/openai"
	einoruntime "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/eino"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

type ambiguityCase struct {
	ID    string          `json:"id"`
	Mode  string          `json:"mode"`
	Why   string          `json:"why"`
	Tasks []string        `json:"tasks"`
	Turns []ambiguityTurn `json:"turns"`
}

type ambiguityTurn struct {
	Text          string `json:"text"`
	RejectInput   bool   `json:"reject_input"`
	NoProposal    bool   `json:"no_proposal"`
	NoDates       bool   `json:"no_dates"`
	ProposalType  string `json:"proposal_type"`
	PendingNone   bool   `json:"pending_none"`
	NoCandidates  bool   `json:"no_candidates"`
	CandidateType string `json:"candidate_type"`
}

// 真实模型质量探针默认跳过，每个场景使用独立虚构用户，两次重复不共享历史。
// 输出只包含用例所需的虚构回复与字段，动态资源 ID 脱敏，不输出 Provider 参数或凭据。
func TestLiveAmbiguityAcceptance(t *testing.T) {
	if os.Getenv("STEWARD_AI_LIVE_AMBIGUITY") != "1" {
		t.Skip("需显式开启无意义与模糊输入的真实模型验收")
	}
	dir, err := DatasetDir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "ambiguity-live.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []ambiguityCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for repeat := 1; repeat <= 2; repeat++ {
		for _, c := range cases {
			t.Run(fmt.Sprintf("%s/第%d次", c.ID, repeat), func(t *testing.T) {
				s := hardeningStack(t)
				p, err := openai.New(openai.Config{
					BaseURL: os.Getenv("STEWARD_AI_BASE_URL"), APIKey: os.Getenv("STEWARD_AI_API_KEY"),
					ParseModel: os.Getenv("STEWARD_AI_MODEL_PARSE"), ChatModel: os.Getenv("STEWARD_AI_MODEL_CHAT"),
					ThinkingMode: "disabled", Timeout: 45 * time.Second, MaxOutputTokens: 1500,
					Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
				})
				if err != nil {
					t.Fatal(err)
				}
				if c.Mode == "capture" {
					runAmbiguousCapture(t, p, c, repeat)
					return
				}
				runAmbiguousAssistant(t, s, p, c, repeat)
			})
		}
	}
}

func runAmbiguousAssistant(t *testing.T, s *Stack, p *openai.Provider, c ambiguityCase, repeat int) {
	t.Helper()
	ctx := t.Context()
	uid, err := s.seedUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.dropUser(context.WithoutCancel(ctx), uid)
	for _, title := range c.Tasks {
		if _, err := s.Objects.CreateTask(ctx, uid, httpapi.CreateTaskRequest{Title: title}); err != nil {
			t.Fatal(err)
		}
	}
	measured := &acceptanceMeasuredProvider{Provider: p, t: t}
	engine := &ambiguityEngine{OrchestrationEngine: einoruntime.New(measured, nil)}
	s.Assistant = assistant.New(s.DB, engine, s.Registry, s.Users, noopEnqueuer{}, s.Proposals, s.Memory, nil, nil)
	thread, err := s.Assistant.CreateThread(ctx, uid, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.taskSnapshot(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	for i, step := range c.Turns {
		row := map[string]any{"id": c.ID, "mode": c.Mode, "repeat": repeat, "turn": i + 1}
		issues := []string{}
		started := time.Now()
		rounds := measured.round
		accepted, acceptErr := s.Assistant.CreateTurn(ctx, uid, thread.ID, httpapi.CreateTurnRequest{Text: step.Text})
		row["accepted"] = acceptErr == nil
		if acceptErr != nil {
			if appErr, ok := apperr.As(acceptErr); ok {
				row["error_code"] = appErr.Code
			}
			if !step.RejectInput {
				issues = append(issues, "非空输入未受理")
			}
			row["elapsed_ms"] = time.Since(started).Milliseconds()
			writeAmbiguityRow(t, row, issues)
			continue
		}
		if step.RejectInput {
			issues = append(issues, "空输入进入模型链路")
		}
		err := s.Assistant.Respond(ctx, assistant.RespondArgs{
			SchemaVersion: 1, UserID: uid, ThreadID: thread.ID, TurnID: accepted.TurnID,
			OperationID: accepted.OperationID, IdempotencyKey: "ambiguity:" + accepted.TurnID,
		})
		row["elapsed_ms"] = time.Since(started).Milliseconds()
		row["model_rounds"] = measured.round - rounds
		row["model_ms"] = engine.last.Usage.LatencyMS
		row["degraded"] = engine.last.Degraded
		if engine.last.Degraded {
			issues = append(issues, "轮次降级，未完成有效回答或澄清")
		}
		if err != nil {
			issues = append(issues, "轮次执行失败")
		}
		var result Result
		if err := s.collect(ctx, uid, accepted.TurnID, &result); err != nil {
			t.Fatal(err)
		}
		row["answer"] = result.Answer
		row["tools"] = result.ExecutedTools
		row["denied"] = result.DeniedTools
		proposals := []map[string]any{}
		found := false
		for _, proposal := range result.Proposals {
			// collect 为旧的单轮 Eval 返回用户全部建议；多轮探针必须仅评估当前轮。
			if proposal.TurnID == nil || *proposal.TurnID != accepted.TurnID {
				continue
			}
			var command map[string]any
			if err := json.Unmarshal(proposal.Command, &command); err != nil {
				t.Fatal(err)
			}
			proposals = append(proposals, map[string]any{"type": proposal.ProposalType, "command": command})
			found = found || proposal.ProposalType == step.ProposalType
			if step.NoDates && commandHasDate(command) {
				issues = append(issues, "无确定日期却填入日期或时间")
			}
		}
		row["proposals"] = proposals
		if step.NoProposal && len(proposals) > 0 {
			issues = append(issues, "应澄清或不行动却生成建议")
		}
		if step.ProposalType != "" && !found {
			issues = append(issues, "信息已足够但缺少预期建议")
		}
		pending, err := s.Proposals.List(ctx, uid, []string{"pending"}, nil, nil, 100)
		if err != nil {
			t.Fatal(err)
		}
		row["pending_count"] = len(pending)
		if step.PendingNone && len(pending) > 0 {
			issues = append(issues, "用户撤回后仍保留待确认建议")
		}
		after, err := s.taskSnapshot(ctx, uid)
		if err != nil {
			t.Fatal(err)
		}
		row["tasks_created"] = len(after) - len(before)
		row["tasks_updated"] = changedTasks(before, after)
		if len(after) != len(before) || changedTasks(before, after) != 0 {
			issues = append(issues, "未确认却改变正式任务")
		}
		writeAmbiguityRow(t, row, issues)
	}
}

func runAmbiguousCapture(t *testing.T, p *openai.Provider, c ambiguityCase, repeat int) {
	t.Helper()
	step := c.Turns[0]
	started := time.Now()
	r, err := p.ParseCapture(t.Context(), ai.CaptureParseRequest{
		RunID: "ambiguity-test", Timezone: "Asia/Shanghai", Now: time.Now(),
		Parts: []ai.InputPart{{ID: "part-ambiguity", Kind: ai.PartText, Position: 0, Text: step.Text}},
	})
	row := map[string]any{"id": c.ID, "mode": c.Mode, "repeat": repeat, "turn": 1, "elapsed_ms": time.Since(started).Milliseconds(), "model_ms": r.Usage.LatencyMS}
	issues := []string{}
	if err != nil {
		issues = append(issues, "Capture 解析失败")
	}
	candidates := []map[string]any{}
	found := false
	for _, candidate := range r.Candidates {
		dates := map[string]any{}
		for key, value := range map[string]*time.Time{"due_date": candidate.DueDate, "due_at": candidate.DueAt, "start_at": candidate.StartAt, "end_at": candidate.EndAt, "start_date": candidate.StartDate, "end_date": candidate.EndDate} {
			if value != nil {
				dates[key] = value.Format(time.RFC3339)
			}
		}
		candidates = append(candidates, map[string]any{"type": candidate.Type, "title": candidate.Title, "description": candidate.Description, "dates": dates, "missing": candidate.Missing, "warnings": candidate.Warnings})
		found = found || candidate.Type == step.CandidateType
		if step.NoDates && len(dates) > 0 {
			issues = append(issues, "Capture 无确定日期却填入日期或时间")
		}
	}
	row["candidates"] = candidates
	row["questions"] = r.Questions
	row["conflicts"] = r.Conflicts
	row["instruction"] = r.InstructionNote
	if step.NoCandidates && len(candidates) > 0 {
		issues = append(issues, "无法理解或否定输入却生成候选")
	}
	if step.NoCandidates && len(candidates) == 0 && len(r.Questions) == 0 {
		issues = append(issues, "无法理解且没有解释或澄清问题")
	}
	if step.CandidateType != "" && !found {
		issues = append(issues, "Capture 缺少预期候选")
	}
	writeAmbiguityRow(t, row, issues)
}

func commandHasDate(command map[string]any) bool {
	for _, key := range []string{"due_date", "due_at", "start_at", "end_at", "start_date", "end_date"} {
		if value, ok := command[key]; ok && value != nil && value != "" {
			return true
		}
	}
	return false
}

var ambiguityResourceID = regexp.MustCompile(`\b[a-z]{2,8}_[A-Za-z0-9]{20,}\b`)

func writeAmbiguityRow(t *testing.T, row map[string]any, issues []string) {
	t.Helper()
	row["issues"] = issues
	raw, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("歧义样本 " + ambiguityResourceID.ReplaceAllString(string(raw), "资源引用已脱敏"))
	if len(issues) > 0 {
		t.Error(strings.Join(issues, "；"))
	}
}

type ambiguityEngine struct {
	ai.OrchestrationEngine
	last ai.TurnResult
}

func (e *ambiguityEngine) RunTurn(ctx context.Context, req ai.TurnRequest) (ai.TurnResult, error) {
	r, err := e.OrchestrationEngine.RunTurn(ctx, req)
	e.last = r
	return r, err
}
