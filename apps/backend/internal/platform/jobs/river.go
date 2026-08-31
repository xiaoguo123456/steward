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
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/aggregate"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/captures"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/media"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/memorymoments"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/retention"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
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

// TrackerArchiveCleanupArgs 是 tracker.archive_cleanup 的 River 任务参数。
// 只保存用户、打卡项和本次归档时间，不保存字段或记录正文。
type TrackerArchiveCleanupArgs struct {
	SchemaVersion  int       `json:"schema_version"`
	UserID         string    `json:"user_id"`
	TrackerID      string    `json:"resource_id"`
	ArchivedBefore time.Time `json:"archived_before"`
}

// Kind 返回任务类型名。
func (TrackerArchiveCleanupArgs) Kind() string { return "tracker.archive_cleanup" }

// InsertOpts 让归档清理进入 retention 队列。
func (TrackerArchiveCleanupArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueRetention, MaxAttempts: 5}
}

// TaskListArchiveCleanupArgs 是 task_list.archive_cleanup 的 River 任务参数。
// 只保存用户、清单与本次归档时间，不保存任务正文。
type TaskListArchiveCleanupArgs struct {
	SchemaVersion  int       `json:"schema_version"`
	UserID         string    `json:"user_id"`
	TaskListID     string    `json:"resource_id"`
	ArchivedBefore time.Time `json:"archived_before"`
}

// AccountDeletionArgs 是 account.deletion 的 River 参数，只含删除请求 ID。
type AccountDeletionArgs struct {
	RequestID string `json:"request_id"`
}

// Kind 返回任务类型名。
func (AccountDeletionArgs) Kind() string { return "account.deletion" }

// InsertOpts 让账号删除进入单并发 retention 队列。
func (AccountDeletionArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueRetention, MaxAttempts: 8}
}

// MemoryMomentMediaDeletionArgs 清理已随时光删除而不可见的媒体对象。
// 任务只保存用户与媒体引用，不复制对象键或签名地址。
type MemoryMomentMediaDeletionArgs struct {
	SchemaVersion int    `json:"schema_version"`
	UserID        string `json:"user_id"`
	MediaID       string `json:"resource_id"`
}

// Kind 返回任务类型名。
func (MemoryMomentMediaDeletionArgs) Kind() string { return "memory_moment.media_deletion" }

// InsertOpts 让媒体物理清理进入单并发 retention 队列。
func (MemoryMomentMediaDeletionArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueRetention, MaxAttempts: 8}
}

// Kind 返回任务类型名。
func (TaskListArchiveCleanupArgs) Kind() string { return "task_list.archive_cleanup" }

// InsertOpts 让归档清理进入 retention 队列。
func (TaskListArchiveCleanupArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: QueueRetention, MaxAttempts: 5}
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

// EnqueueTrackerArchiveCleanup 在归档事务内登记 30 天后的清理任务。
func (e *Enqueuer) EnqueueTrackerArchiveCleanup(
	ctx context.Context, _ *dbgen.Queries, args trackers.ArchiveCleanupArgs,
) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, TrackerArchiveCleanupArgs{
		SchemaVersion:  1,
		UserID:         args.UserID,
		TrackerID:      args.TrackerID,
		ArchivedBefore: args.ArchivedBefore,
	}, &river.InsertOpts{
		Queue:       QueueRetention,
		MaxAttempts: 5,
		ScheduledAt: args.RunAt,
	})
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记打卡项归档清理任务失败：%w", err))
	}
	return nil
}

// EnqueueTaskListArchiveCleanup 在归档事务内登记到期清理任务。
func (e *Enqueuer) EnqueueTaskListArchiveCleanup(
	ctx context.Context, _ *dbgen.Queries, args lists.ArchiveCleanupArgs,
) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, TaskListArchiveCleanupArgs{
		SchemaVersion:  1,
		UserID:         args.UserID,
		TaskListID:     args.TaskListID,
		ArchivedBefore: args.ArchivedBefore,
	}, &river.InsertOpts{
		Queue:       QueueRetention,
		MaxAttempts: 5,
		ScheduledAt: args.RunAt,
	})
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记清单归档清理任务失败：%w", err))
	}
	return nil
}

// EnqueueAccountDeletion 在受理事务内登记账号删除任务。
func (e *Enqueuer) EnqueueAccountDeletion(
	ctx context.Context, _ *dbgen.Queries, args retention.AccountDeletionArgs,
) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, AccountDeletionArgs{RequestID: args.RequestID}, nil)
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记账号删除任务失败：%w", err))
	}
	return nil
}

// EnqueueMemoryMomentMediaDeletion 在时光删除事务内登记媒体物理清理。
func (e *Enqueuer) EnqueueMemoryMomentMediaDeletion(
	ctx context.Context, _ *dbgen.Queries, args memorymoments.MediaDeletionArgs,
) error {
	tx, err := database.TxFrom(ctx)
	if err != nil {
		return apperr.Internal(err)
	}
	_, err = e.client.InsertTx(ctx, tx, MemoryMomentMediaDeletionArgs{
		SchemaVersion: 1, UserID: args.UserID, MediaID: args.MediaID,
	}, nil)
	if err != nil {
		return apperr.Internal(fmt.Errorf("登记时光媒体清理任务失败：%w", err))
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

// TrackerArchiveCleanupWorker 清理已归档满 30 天且期间未恢复的打卡项。
type TrackerArchiveCleanupWorker struct {
	river.WorkerDefaults[TrackerArchiveCleanupArgs]
	svc    *trackers.Service
	logger *slog.Logger
}

// TaskListArchiveCleanupWorker 清理到期且期间未恢复的任务清单。
type TaskListArchiveCleanupWorker struct {
	river.WorkerDefaults[TaskListArchiveCleanupArgs]
	svc    *lists.Service
	logger *slog.Logger
}

// AccountDeletionWorker 执行账号在线数据清理。
type AccountDeletionWorker struct {
	river.WorkerDefaults[AccountDeletionArgs]
	svc    *retention.Service
	logger *slog.Logger
}

// MemoryMomentMediaDeletionWorker 物理清理已经不可见的时光媒体对象。
type MemoryMomentMediaDeletionWorker struct {
	river.WorkerDefaults[MemoryMomentMediaDeletionArgs]
	svc    *media.Service
	logger *slog.Logger
}

// Work 执行删除；只有重试耗尽后才公开 failed。
func (w *AccountDeletionWorker) Work(ctx context.Context, job *river.Job[AccountDeletionArgs]) error {
	err := w.svc.RunDeletion(ctx, job.Args.RequestID)
	if err == nil {
		return nil
	}
	w.logger.Error("账号删除任务失败", "request_id", job.Args.RequestID,
		"attempt", job.Attempt, "error", err)
	if job.Attempt >= job.MaxAttempts {
		if markErr := w.svc.MarkFailed(ctx, job.Args.RequestID); markErr != nil {
			w.logger.Error("标记账号删除失败时出错", "request_id", job.Args.RequestID,
				"error", markErr)
		}
	}
	return err
}

// Work 执行可重试且幂等的媒体对象清理。
func (w *MemoryMomentMediaDeletionWorker) Work(
	ctx context.Context, job *river.Job[MemoryMomentMediaDeletionArgs],
) error {
	err := w.svc.PurgeDeleted(ctx, job.Args.UserID, job.Args.MediaID)
	if err != nil {
		w.logger.Error("清理时光媒体对象失败", "media_id", job.Args.MediaID,
			"attempt", job.Attempt, "error", err)
	}
	return err
}

// Work 执行一次幂等清单归档清理。
func (w *TaskListArchiveCleanupWorker) Work(
	ctx context.Context, job *river.Job[TaskListArchiveCleanupArgs],
) error {
	err := w.svc.RunArchiveCleanup(ctx, lists.ArchiveCleanupArgs{
		UserID:         job.Args.UserID,
		TaskListID:     job.Args.TaskListID,
		ArchivedBefore: job.Args.ArchivedBefore,
	})
	if err != nil {
		w.logger.Error("清理过期归档清单失败", "task_list_id", job.Args.TaskListID, "error", err)
	}
	return err
}

// Work 执行一次幂等归档清理。
func (w *TrackerArchiveCleanupWorker) Work(
	ctx context.Context, job *river.Job[TrackerArchiveCleanupArgs],
) error {
	err := w.svc.RunArchiveCleanup(ctx, trackers.ArchiveCleanupArgs{
		UserID:         job.Args.UserID,
		TrackerID:      job.Args.TrackerID,
		ArchivedBefore: job.Args.ArchivedBefore,
	})
	if err != nil {
		w.logger.Error("清理过期归档打卡项失败", "tracker_id", job.Args.TrackerID, "error", err)
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
	Trackers  *trackers.Service
	Lists     *lists.Service
	Media     *media.Service
	Retention *retention.Service
	// Aggregate 生成后台读模型。为空时不注册周期任务，
	// 后台会看到 aggregation_status=pending 而不是一份看起来正常的空数据。
	Aggregate *aggregate.Service
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
		if err := river.AddWorkerSafely(workers,
			&TrackerArchiveCleanupWorker{svc: deps.Trackers, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册打卡项归档清理 Worker 失败：%w", err)
		}
		if err := river.AddWorkerSafely(workers,
			&TaskListArchiveCleanupWorker{svc: deps.Lists, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册清单归档清理 Worker 失败：%w", err)
		}
		if err := river.AddWorkerSafely(workers,
			&AccountDeletionWorker{svc: deps.Retention, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册账号删除 Worker 失败：%w", err)
		}
		if err := river.AddWorkerSafely(workers,
			&MemoryMomentMediaDeletionWorker{svc: deps.Media, logger: logger}); err != nil {
			return nil, fmt.Errorf("注册时光媒体清理 Worker 失败：%w", err)
		}
		logger.Info("注册周期任务", "aggregate_enabled", deps.Aggregate != nil)
		if deps.Aggregate != nil {
			if err := river.AddWorkerSafely(workers,
				&AdminAggregateWorker{svc: deps.Aggregate, logger: logger}); err != nil {
				return nil, fmt.Errorf("注册后台聚合 Worker 失败：%w", err)
			}
			// 每小时刷新当天的数据。
			//
			// **不是「每小时算一次昨天」**：后台最常看的就是今天，
			// 而今天的数据一直在变。整点重算当天，昨天由零点那次固化。
			config.PeriodicJobs = append(config.PeriodicJobs, river.NewPeriodicJob(
				river.PeriodicInterval(time.Hour),
				func() (river.JobArgs, *river.InsertOpts) {
					return AdminAggregateArgs{}, &river.InsertOpts{Queue: QueueRetention}
				},
				&river.PeriodicJobOpts{RunOnStart: true},
			))
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

// AdminAggregateArgs 是后台读模型聚合任务的参数。
//
// Day 为空表示「算今天」。补跑历史时显式传日期——聚合是幂等的，
// 同一天重跑多少遍结果都一样。
type AdminAggregateArgs struct {
	Day string `json:"day,omitempty"`
}

// Kind 返回任务类型名。
func (AdminAggregateArgs) Kind() string { return "admin.aggregate" }

// AdminAggregateWorker 执行后台读模型聚合。
type AdminAggregateWorker struct {
	river.WorkerDefaults[AdminAggregateArgs]
	svc    *aggregate.Service
	logger *slog.Logger
}

// Work 生成某一天的读模型。
func (w *AdminAggregateWorker) Work(ctx context.Context, job *river.Job[AdminAggregateArgs]) error {
	day := time.Now()
	if job.Args.Day != "" {
		parsed, err := time.Parse("2006-01-02", job.Args.Day)
		if err != nil {
			// 参数错了重试多少次都一样，直接放弃而不是无限重试。
			w.logger.Error("后台聚合日期不合法", "day", job.Args.Day, "error", err)
			return river.JobCancel(err)
		}
		day = parsed
	}
	written, err := w.svc.RunDaily(ctx, day)
	if err != nil {
		return err
	}
	w.logger.Info("后台读模型已更新", "date", day.Format("2006-01-02"), "users", written)
	return nil
}
