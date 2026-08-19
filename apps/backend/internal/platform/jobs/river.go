// Package jobs 封装 River 队列。
//
// 队列划分与文档一致：ai 承载模型相关任务，search 承载索引重建，
// retention 承载清理。业务写入与入队使用同一个事务，
// 避免出现“业务成功但任务丢失”。
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/captures"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 队列名称。
const (
	QueueAI        = "ai"
	QueueSearch    = "search"
	QueueRetention = "retention"
)

// CaptureParseArgs 是 capture.parse 的 River 任务参数。
//
// 它只携带引用与幂等键，不包含消息正文、记忆、工具结果或 Prompt。
type CaptureParseArgs struct {
	SchemaVersion  int    `json:"schema_version"`
	UserID         string `json:"user_id"`
	CaptureID      string `json:"resource_id"`
	Revision       int    `json:"resource_version"`
	OperationID    string `json:"operation_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// Kind 返回任务类型名。
func (CaptureParseArgs) Kind() string { return "capture.parse" }

// InsertOpts 让解析任务进入 ai 队列。
func (CaptureParseArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueAI, MaxAttempts: 3}
}

// AssistantRespondArgs 是 assistant.respond 的 River 任务参数。
//
// 与解析任务同样的约定：只携带引用与幂等键，不含消息正文、记忆、
// 工具结果或 Prompt。任务表不是用户内容的第二份存储。
type AssistantRespondArgs struct {
	SchemaVersion  int    `json:"schema_version"`
	UserID         string `json:"user_id"`
	ThreadID       string `json:"thread_id"`
	TurnID         string `json:"resource_id"`
	OperationID    string `json:"operation_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// Kind 返回任务类型名。
func (AssistantRespondArgs) Kind() string { return "assistant.respond" }

// InsertOpts 让回复任务进入 ai 队列。
//
// MaxAttempts 为 2：模型调用很贵，反复重试的收益远小于成本，
// 失败时给用户一个明确的降级提示比默默重试三次更好。
func (AssistantRespondArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueAI, MaxAttempts: 2}
}

// ReviewGenerateArgs 是 review.generate 的 River 任务参数。
type ReviewGenerateArgs struct {
	SchemaVersion  int        `json:"schema_version"`
	UserID         string     `json:"user_id"`
	WeekOf         *time.Time `json:"week_of"`
	OperationID    string     `json:"operation_id"`
	IdempotencyKey string     `json:"idempotency_key"`
}

// Kind 返回任务类型名。
func (ReviewGenerateArgs) Kind() string { return "review.generate" }

// InsertOpts 让复盘生成进入 ai 队列。
func (ReviewGenerateArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueAI, MaxAttempts: 2}
}

// Enqueuer 在业务事务内登记任务，实现 captures.JobEnqueuer。
type Enqueuer struct {
	client *river.Client[pgx.Tx]
}

// EnqueueCaptureParse 在当前事务内登记一次解析任务。
// q 参数保持与 captures.JobEnqueuer 一致；实际入队使用上下文中的事务句柄。
func (e *Enqueuer) EnqueueCaptureParse(ctx context.Context, _ *dbgen.Queries, args captures.CaptureParseArgs) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, CaptureParseArgs{
		SchemaVersion:  args.SchemaVersion,
		UserID:         args.UserID,
		CaptureID:      args.CaptureID,
		Revision:       args.Revision,
		OperationID:    args.OperationID,
		IdempotencyKey: args.IdempotencyKey,
	}, nil)
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记解析任务失败：%w", err))
	}
	return nil
}

// EnqueueAssistantRespond 在当前事务内登记一次回复任务。
func (e *Enqueuer) EnqueueAssistantRespond(ctx context.Context, _ *dbgen.Queries, args assistant.RespondArgs) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, AssistantRespondArgs{
		SchemaVersion:  args.SchemaVersion,
		UserID:         args.UserID,
		ThreadID:       args.ThreadID,
		TurnID:         args.TurnID,
		OperationID:    args.OperationID,
		IdempotencyKey: args.IdempotencyKey,
	}, nil)
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记回复任务失败：%w", err))
	}
	return nil
}

// EnqueueReviewGenerate 在当前事务内登记一次复盘生成任务。
func (e *Enqueuer) EnqueueReviewGenerate(ctx context.Context, _ *dbgen.Queries, args views.GenerateArgs) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, ReviewGenerateArgs{
		SchemaVersion:  args.SchemaVersion,
		UserID:         args.UserID,
		WeekOf:         args.WeekOf,
		OperationID:    args.OperationID,
		IdempotencyKey: args.IdempotencyKey,
	}, nil)
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记复盘生成任务失败：%w", err))
	}
	return nil
}

// CaptureParseWorker 执行解析任务。
type CaptureParseWorker struct {
	river.WorkerDefaults[CaptureParseArgs]
	svc    *captures.Service
	logger *slog.Logger
}

// Work 调用 Capture 服务完成一次解析。
func (w *CaptureParseWorker) Work(ctx context.Context, job *river.Job[CaptureParseArgs]) error {
	err := w.svc.RunParse(ctx, captures.CaptureParseArgs{
		SchemaVersion:  job.Args.SchemaVersion,
		UserID:         job.Args.UserID,
		CaptureID:      job.Args.CaptureID,
		Revision:       job.Args.Revision,
		OperationID:    job.Args.OperationID,
		IdempotencyKey: job.Args.IdempotencyKey,
	})
	if err != nil {
		w.logger.Error("解析任务失败",
			"capture_id", job.Args.CaptureID,
			"revision", job.Args.Revision,
			"error", err)
	}
	return err
}

// AssistantRespondWorker 执行回复任务。
type AssistantRespondWorker struct {
	river.WorkerDefaults[AssistantRespondArgs]
	svc    *assistant.Service
	logger *slog.Logger
}

// Work 调用 Assistant 服务完成一次回复。
func (w *AssistantRespondWorker) Work(ctx context.Context, job *river.Job[AssistantRespondArgs]) error {
	args := assistant.RespondArgs{
		SchemaVersion:  job.Args.SchemaVersion,
		UserID:         job.Args.UserID,
		ThreadID:       job.Args.ThreadID,
		TurnID:         job.Args.TurnID,
		OperationID:    job.Args.OperationID,
		IdempotencyKey: job.Args.IdempotencyKey,
	}
	err := w.svc.Respond(ctx, args)
	if err == nil {
		return nil
	}

	w.logger.Error("回复任务失败", "turn_id", job.Args.TurnID,
		"attempt", job.Attempt, "error", err)

	// 队列不会再重试了，必须自己把 Operation 收尾，
	// 否则界面上是一个永远转不完的圈。
	if job.Attempt >= job.MaxAttempts {
		if markErr := w.svc.MarkTurnPermanentlyFailed(ctx, args); markErr != nil {
			w.logger.Error("标记回复失败时出错",
				"turn_id", job.Args.TurnID, "error", markErr)
		}
	}
	return err
}

// ReviewGenerateWorker 执行复盘叙述生成任务。
type ReviewGenerateWorker struct {
	river.WorkerDefaults[ReviewGenerateArgs]
	svc    *views.Service
	logger *slog.Logger
}

// Work 调用 Views 服务生成复盘叙述。
func (w *ReviewGenerateWorker) Work(ctx context.Context, job *river.Job[ReviewGenerateArgs]) error {
	err := w.svc.RunGenerate(ctx, views.GenerateArgs{
		SchemaVersion:  job.Args.SchemaVersion,
		UserID:         job.Args.UserID,
		WeekOf:         job.Args.WeekOf,
		OperationID:    job.Args.OperationID,
		IdempotencyKey: job.Args.IdempotencyKey,
	})
	if err != nil {
		w.logger.Error("复盘生成任务失败", "user_id", job.Args.UserID, "error", err)
	}
	return err
}

// Runtime 同时提供入队与执行能力。
type Runtime struct {
	client   *river.Client[pgx.Tx]
	Enqueuer *Enqueuer
}

// Migrate 应用 River 自身的表结构。由 migrate 入口调用。
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("创建 River 迁移器失败：%w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("应用 River 迁移失败：%w", err)
	}
	return nil
}

// Deps 是 Worker 需要的业务服务。API 进程只入队，可以全部留空。
type Deps struct {
	Captures  *captures.Service
	Assistant *assistant.Service
	Views     *views.Service
}

// New 构造 Runtime。runWorkers 为 false 时只入队不执行，适用于 API 进程。
func New(pool *pgxpool.Pool, deps Deps, logger *slog.Logger, runWorkers bool) (*Runtime, error) {
	config := &river.Config{Logger: logger}

	if runWorkers {
		workers := river.NewWorkers()
		if err := river.AddWorkerSafely(workers,
			&CaptureParseWorker{svc: deps.Captures, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册解析 Worker 失败：%w", err)
		}
		if err := river.AddWorkerSafely(workers,
			&AssistantRespondWorker{svc: deps.Assistant, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册回复 Worker 失败：%w", err)
		}
		if err := river.AddWorkerSafely(workers,
			&ReviewGenerateWorker{svc: deps.Views, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册复盘 Worker 失败：%w", err)
		}
		config.Workers = workers
		config.Queues = map[string]river.QueueConfig{
			QueueAI:        {MaxWorkers: 4},
			QueueSearch:    {MaxWorkers: 2},
			QueueRetention: {MaxWorkers: 1},
		}
	}

	client, err := river.NewClient(riverpgxv5.New(pool), config)
	if err != nil {
		return nil, fmt.Errorf("创建 River 客户端失败：%w", err)
	}
	return &Runtime{client: client, Enqueuer: &Enqueuer{client: client}}, nil
}

// Start 启动 Worker 循环。只入队的进程不需要调用。
func (r *Runtime) Start(ctx context.Context) error {
	return r.client.Start(ctx)
}

// Stop 优雅停止 Worker。
func (r *Runtime) Stop(ctx context.Context) error {
	return r.client.Stop(ctx)
}
