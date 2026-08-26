package lists_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type cleanupQueue struct {
	args []lists.ArchiveCleanupArgs
}

func (q *cleanupQueue) EnqueueTaskListArchiveCleanup(
	_ context.Context, _ *dbgen.Queries, args lists.ArchiveCleanupArgs,
) error {
	q.args = append(q.args, args)
	return nil
}

func TestTaskListArchiveRetention(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过清单归档保留集成测试")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("198%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			`SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "清单归档测试用户", "Asia/Shanghai",
		).Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	t.Cleanup(func() {
		_ = db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
			return err
		})
	})

	const retention = 72 * time.Hour
	queue := &cleanupQueue{}
	svc := lists.New(db).WithArchiveRetention(retention).WithJobs(queue)

	var defaultList dbgen.TaskList
	var otherList dbgen.TaskList
	taskID := idgen.New(idgen.PrefixTask)
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		defaultList, err = svc.EnsureDefaultList(ctx, q, userID)
		if err != nil {
			return err
		}
		otherList, err = q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "工作",
			Position: 1, IsDefault: false, ListKind: "tasks",
		})
		if err != nil {
			return err
		}
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO tasks (
				id, user_id, title, status, priority, list_id, reminders, created_by, provenance_refs
			) VALUES ($1, $2, $3, 'todo', 'normal', $4, '[]'::jsonb, 'user', '[]'::jsonb)`,
			taskID, userID, "需要迁移的任务", defaultList.ID,
		)
		return err
	})
	if err != nil {
		t.Fatalf("准备清单数据失败：%v", err)
	}

	archived := true
	first, err := svc.Update(ctx, userID, defaultList.ID, lists.UpdateInput{
		Archived: &archived, ExpectedVersion: &defaultList.Version,
	})
	if err != nil {
		t.Fatalf("归档内部默认清单失败：%v", err)
	}
	if first.IsDefault || first.ArchivedAt == nil {
		t.Fatal("归档后仍保留默认标记或缺少 archived_at")
	}
	if len(queue.args) != 1 || queue.args[0].RunAt.Sub(queue.args[0].ArchivedBefore) != retention {
		t.Fatalf("清理任务没有使用配置的保留期：%+v", queue.args)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		currentDefault, err := q.GetDefaultTaskList(ctx)
		if err != nil {
			return err
		}
		if currentDefault.ID != otherList.ID {
			return fmt.Errorf("默认落点未转移到另一个活动清单：%s", currentDefault.ID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	restored := false
	second, err := svc.Update(ctx, userID, defaultList.ID, lists.UpdateInput{
		Archived: &restored, ExpectedVersion: &first.Version,
	})
	if err != nil {
		t.Fatalf("恢复清单失败：%v", err)
	}
	if second.ArchivedAt != nil {
		t.Fatal("恢复后 archived_at 没有清空")
	}
	if err := svc.RunArchiveCleanup(ctx, queue.args[0]); err != nil {
		t.Fatalf("旧清理任务空跑失败：%v", err)
	}

	time.Sleep(2 * time.Millisecond)
	third, err := svc.Update(ctx, userID, defaultList.ID, lists.UpdateInput{
		Archived: &archived, ExpectedVersion: &second.Version,
	})
	if err != nil {
		t.Fatalf("再次归档清单失败：%v", err)
	}
	if third.ArchivedAt == nil || len(queue.args) != 2 {
		t.Fatal("再次归档没有开始新的保留周期")
	}
	if err := svc.RunArchiveCleanup(ctx, queue.args[0]); err != nil {
		t.Fatalf("旧任务不应影响新一轮归档：%v", err)
	}

	if err := svc.RunArchiveCleanup(ctx, queue.args[1]); err != nil {
		t.Fatalf("执行到期清理失败：%v", err)
	}
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetTaskList(ctx, defaultList.ID); !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("到期清单仍可读取：%w", err)
		}
		task, err := q.GetTask(ctx, taskID)
		if err != nil {
			return err
		}
		if task.ListID != otherList.ID {
			return fmt.Errorf("任务没有迁移到当前默认清单：%s", task.ListID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	var manuallyDeleted dbgen.TaskList
	manualTaskID := idgen.New(idgen.PrefixTask)
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		manuallyDeleted, err = q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "稍后删除",
			Position: 2, IsDefault: false, ListKind: "tasks",
		})
		if err != nil {
			return err
		}
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO tasks (
				id, user_id, title, status, priority, list_id, reminders, created_by, provenance_refs
			) VALUES ($1, $2, $3, 'todo', 'normal', $4, '[]'::jsonb, 'user', '[]'::jsonb)`,
			manualTaskID, userID, "手动删除前迁移的任务", manuallyDeleted.ID,
		)
		return err
	})
	if err != nil {
		t.Fatalf("准备手动删除数据失败：%v", err)
	}

	if _, err := svc.Update(ctx, userID, manuallyDeleted.ID, lists.UpdateInput{
		Archived: &archived, ExpectedVersion: &manuallyDeleted.Version,
	}); err != nil {
		t.Fatalf("归档待手动删除清单失败：%v", err)
	}
	if err := svc.Delete(ctx, userID, manuallyDeleted.ID, nil); err != nil {
		t.Fatalf("直接删除已归档清单失败：%v", err)
	}
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetTaskList(ctx, manuallyDeleted.ID); !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("手动删除后的归档清单仍可读取：%w", err)
		}
		task, err := q.GetTask(ctx, manualTaskID)
		if err != nil {
			return err
		}
		if task.ListID != otherList.ID {
			return fmt.Errorf("手动删除前任务没有迁入默认清单：%s", task.ListID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RunArchiveCleanup(ctx, queue.args[len(queue.args)-1]); err != nil {
		t.Fatalf("手动删除后的延时任务没有幂等空跑：%v", err)
	}
}
