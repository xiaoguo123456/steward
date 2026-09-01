package captures

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type confirmObjectCommands struct{ noteCreates atomic.Int32 }

func (*confirmObjectCommands) CreateTaskInTx(context.Context, *dbgen.Queries, string, objects.CreateTaskCommand) (dbgen.Task, error) {
	return dbgen.Task{}, fmt.Errorf("测试不应创建任务")
}
func (*confirmObjectCommands) CreateEventInTx(context.Context, *dbgen.Queries, string, objects.CreateEventCommand) (dbgen.Event, error) {
	return dbgen.Event{}, fmt.Errorf("测试不应创建日程")
}
func (f *confirmObjectCommands) CreateNoteInTx(_ context.Context, _ *dbgen.Queries, userID string, cmd objects.CreateNoteCommand) (dbgen.Note, error) {
	f.noteCreates.Add(1)
	title := ""
	if cmd.Title != nil {
		title = *cmd.Title
	}
	return dbgen.Note{ID: idgen.New(idgen.PrefixNote), UserID: userID, Title: title}, nil
}
func (*confirmObjectCommands) CreateProjectInTx(context.Context, *dbgen.Queries, string, objects.CreateProjectCommand) (dbgen.Project, error) {
	return dbgen.Project{}, fmt.Errorf("测试不应创建项目")
}
func (*confirmObjectCommands) UpdateTaskCommandInTx(context.Context, *dbgen.Queries, string, string, httpapi.UpdateTaskRequest, int32) (dbgen.Task, error) {
	return dbgen.Task{}, fmt.Errorf("测试不应更新任务")
}
func (*confirmObjectCommands) UpdateEventCommandInTx(context.Context, *dbgen.Queries, string, string, httpapi.UpdateEventRequest, int32) (dbgen.Event, error) {
	return dbgen.Event{}, fmt.Errorf("测试不应更新日程")
}
func (*confirmObjectCommands) UpdateNoteCommandInTx(context.Context, *dbgen.Queries, string, string, httpapi.UpdateNoteRequest, int32) (dbgen.Note, error) {
	return dbgen.Note{}, fmt.Errorf("测试不应更新笔记")
}
func (*confirmObjectCommands) UpdateProjectCommandInTx(context.Context, *dbgen.Queries, string, string, httpapi.UpdateProjectRequest, int32) (dbgen.Project, error) {
	return dbgen.Project{}, fmt.Errorf("测试不应更新项目")
}

type blockingCaptureParser struct {
	started chan struct{}
	release chan struct{}
}

func (*blockingCaptureParser) Name() string { return "blocking-test" }
func (p *blockingCaptureParser) ParseCapture(ctx context.Context, _ ai.CaptureParseRequest) (ai.CaptureParseResult, error) {
	close(p.started)
	select {
	case <-p.release:
		return ai.CaptureParseResult{Candidates: []ai.CandidateDraft{{
			Type: "note", Action: "create", Title: "迟到候选", Content: "不应保存",
		}}}, nil
	case <-ctx.Done():
		return ai.CaptureParseResult{}, ctx.Err()
	}
}

type captureTestUsers struct{}

func (captureTestUsers) Timezone(context.Context, *dbgen.Queries, string) (string, error) {
	return "Asia/Shanghai", nil
}
func (captureTestUsers) AiSettingsInTx(context.Context, *dbgen.Queries, string) (dbgen.UserAiSetting, error) {
	return dbgen.UserAiSetting{CaptureParseEnabled: true}, nil
}

func captureIntegrationDB(t *testing.T) *database.DB {
	t.Helper()
	dsn := config.LoadForTest().DatabaseURL
	if dsn == "" {
		t.Skip("未设置测试数据库，跳过 Capture 并发集成测试")
	}
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func seedCaptureUser(t *testing.T, db *database.DB) string {
	t.Helper()
	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("195%08d", time.Now().UnixNano()%100000000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "Capture 并发测试", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	t.Cleanup(func() {
		_ = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID)
			return err
		})
	})
	return userID
}

func TestConfirmConcurrentReplayCreatesObjectsOnce(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	captureID := idgen.New(idgen.PrefixCapture)
	candidateID := idgen.New(idgen.PrefixCandidate)
	title := "并发确认笔记"
	payload, err := json.Marshal(httpapi.CaptureDraftPayload{Note: &httpapi.CaptureNoteDraft{
		Title: &title, Content: "只应创建一次",
	}})
	if err != nil {
		t.Fatal(err)
	}
	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
			ID: captureID, UserID: userID, Status: "needs_confirmation", Origin: "home", Timezone: "Asia/Shanghai",
		}); err != nil {
			return err
		}
		_, err := q.CreateCaptureCandidate(ctx, dbgen.CreateCaptureCandidateParams{
			ID: candidateID, UserID: userID, CaptureID: captureID, Revision: 1,
			CandidateType: "note", Action: "create", Selected: true, Payload: payload,
			FieldConfidences: []byte("[]"), SourceRefs: []byte("[]"), MissingFields: []string{},
			Warnings: []string{}, Position: 0,
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备 Capture 失败：%v", err)
	}

	commands := &confirmObjectCommands{}
	svc := &Service{db: db, objects: commands, activity: activity.New(db)}
	body := httpapi.ConfirmCaptureRequest{Revision: 1, Items: []httpapi.ConfirmCaptureItem{{CandidateId: candidateID}}}
	results := make([]ConfirmResult, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			results[index], errs[index] = svc.Confirm(context.Background(), userID, captureID, "same-confirm-key", body)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("并发确认失败：%v", err)
		}
	}
	if got := commands.noteCreates.Load(); got != 1 {
		t.Fatalf("正式对象创建次数 = %d，期望 1", got)
	}
	if results[0].BatchID == "" || results[0].BatchID != results[1].BatchID {
		t.Fatalf("重放响应没有复用首次批次：%q / %q", results[0].BatchID, results[1].BatchID)
	}
	if len(results[0].Affected) != len(results[1].Affected) {
		t.Fatalf("重放响应资源数量不一致：%d / %d", len(results[0].Affected), len(results[1].Affected))
	}
	changed := body
	changed.Revision = 99
	_, err = svc.Confirm(context.Background(), userID, captureID, "same-confirm-key", changed)
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeIdempotencyReused {
		t.Fatalf("相同幂等键更换请求体应被拒绝，实际：%v", err)
	}
}

func TestRunParseLateProviderResultCannotReviveDiscardedCapture(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	captureID := idgen.New(idgen.PrefixCapture)
	partID := idgen.New(idgen.PrefixCapturePart)
	operationID := idgen.New(idgen.PrefixOperation)
	text := "稍后会被放弃"
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
			ID: captureID, UserID: userID, Status: "parsing", Origin: "home", Timezone: "Asia/Shanghai",
		}); err != nil {
			return err
		}
		if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
			ID: partID, UserID: userID, CaptureID: captureID, Revision: 1,
			Kind: "text", Status: "succeeded", Position: 0, Text: &text,
		}); err != nil {
			return err
		}
		_, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID: operationID, UserID: userID, Kind: "capture.parse",
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备 Capture 失败：%v", err)
	}

	parser := &blockingCaptureParser{started: make(chan struct{}), release: make(chan struct{})}
	svc := &Service{db: db, parser: parser, users: captureTestUsers{}}
	args := CaptureParseArgs{SchemaVersion: 1, UserID: userID, CaptureID: captureID,
		Revision: 1, OperationID: operationID, IdempotencyKey: "late-provider-result"}
	done := make(chan error, 1)
	go func() { done <- svc.RunParse(context.Background(), args) }()
	select {
	case <-parser.started:
	case <-time.After(5 * time.Second):
		t.Fatal("Provider 没有开始执行")
	}
	if err := svc.Discard(context.Background(), userID, captureID); err != nil {
		t.Fatalf("放弃 Capture 失败：%v", err)
	}
	close(parser.release)
	if err := <-done; err != nil {
		t.Fatalf("迟到 Worker 收尾失败：%v", err)
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		capture, err := q.GetCapture(ctx, captureID)
		if err != nil {
			return err
		}
		if capture.Status != "discarded" {
			t.Fatalf("迟到结果覆盖了终态，当前状态：%s", capture.Status)
		}
		candidates, err := q.ListCaptureCandidates(ctx, dbgen.ListCaptureCandidatesParams{
			CaptureID: captureID, Revision: 1,
		})
		if err != nil {
			return err
		}
		if len(candidates) != 0 {
			t.Fatalf("迟到结果写入了 %d 个候选", len(candidates))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("校验结果失败：%v", err)
	}
}

func TestRunParseLateProviderResultCannotOverwriteNewRevision(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	captureID := idgen.New(idgen.PrefixCapture)
	operationID := idgen.New(idgen.PrefixOperation)
	text := "第一版输入"
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
			ID: captureID, UserID: userID, Status: "parsing", Origin: "home", Timezone: "Asia/Shanghai",
		}); err != nil {
			return err
		}
		if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
			ID: idgen.New(idgen.PrefixCapturePart), UserID: userID, CaptureID: captureID, Revision: 1,
			Kind: "text", Status: "succeeded", Position: 0, Text: &text,
		}); err != nil {
			return err
		}
		_, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID: operationID, UserID: userID, Kind: "capture.parse",
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备 Capture 失败：%v", err)
	}

	parser := &blockingCaptureParser{started: make(chan struct{}), release: make(chan struct{})}
	svc := &Service{db: db, parser: parser, users: captureTestUsers{}}
	args := CaptureParseArgs{SchemaVersion: 1, UserID: userID, CaptureID: captureID,
		Revision: 1, OperationID: operationID, IdempotencyKey: "late-old-revision"}
	done := make(chan error, 1)
	go func() { done <- svc.RunParse(context.Background(), args) }()
	select {
	case <-parser.started:
	case <-time.After(5 * time.Second):
		t.Fatal("Provider 没有开始执行")
	}
	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.BumpCaptureRevision(ctx, dbgen.BumpCaptureRevisionParams{
			ID: captureID, Status: "parsing",
		})
		return err
	})
	if err != nil {
		t.Fatalf("推进 revision 失败：%v", err)
	}
	close(parser.release)
	if err := <-done; err != nil {
		t.Fatalf("迟到 Worker 收尾失败：%v", err)
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		capture, err := q.GetCapture(ctx, captureID)
		if err != nil {
			return err
		}
		if capture.Revision != 2 || capture.Status != "parsing" {
			t.Fatalf("迟到结果覆盖了新 revision：revision=%d status=%s", capture.Revision, capture.Status)
		}
		candidates, err := q.ListCaptureCandidates(ctx, dbgen.ListCaptureCandidatesParams{
			CaptureID: captureID, Revision: 1,
		})
		if err != nil {
			return err
		}
		if len(candidates) != 0 {
			t.Fatalf("迟到结果向旧 revision 写入了 %d 个候选", len(candidates))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("校验结果失败：%v", err)
	}
}
