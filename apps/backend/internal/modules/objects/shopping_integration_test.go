package objects

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

func shoppingTestDB(t *testing.T) *database.DB {
	t.Helper()
	databaseURL := config.LoadForTest().DatabaseURL
	if databaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过购物清单集成测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func seedShoppingTestUser(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := fmt.Sprintf("17%09d", time.Now().UnixNano()%1_000_000_000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "购物测试", "Asia/Shanghai").Scan(&userID)
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

func TestShoppingTasksUseOneListAndStayOutOfPlan(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	listService := lists.New(db)
	objectService := &Service{}

	now := time.Now()
	day := timeutil.DayOf(now, timeutil.LoadLocation("Asia/Shanghai"))
	dayStart, dayEnd := day.Start, day.End

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		planList, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "普通清单",
			Position: 0, IsDefault: true, ListKind: "tasks",
		})
		if err != nil {
			return err
		}
		shoppingList, err := listService.EnsureShoppingList(ctx, q, userID,
			lists.ShoppingListInput{Name: "购物清单"})
		if err != nil {
			return err
		}
		again, err := listService.EnsureShoppingList(ctx, q, userID,
			lists.ShoppingListInput{Name: "另一份购物清单"})
		if err != nil {
			return err
		}
		if again.ID != shoppingList.ID {
			t.Fatalf("重复确保购物清单时创建了新清单：%s != %s", again.ID, shoppingList.ID)
		}

		if _, err := q.CreateTask(ctx, taskFixture(userID, planList.ID, "普通任务", nil)); err != nil {
			return err
		}
		if _, err := q.CreateTask(ctx, taskFixture(userID, shoppingList.ID, "昨天买到", ptrTime(dayStart.Add(-time.Hour)))); err != nil {
			return err
		}
		if _, err := q.CreateTask(ctx, taskFixture(userID, shoppingList.ID, "今天买到", ptrTime(now))); err != nil {
			return err
		}

		kind := "tasks"
		planTasks, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses: []string{"todo", "doing", "done"}, ListKind: &kind, RowLimit: 100,
		})
		if err != nil {
			return err
		}
		if len(planTasks) != 1 || planTasks[0].Title != "普通任务" {
			t.Fatalf("计划查询混入购物商品：%v", taskTitles(planTasks))
		}

		todayDone, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses: []string{"done"}, ListID: &shoppingList.ID,
			CompletedFrom: &dayStart, CompletedTo: &dayEnd, RowLimit: 100,
		})
		if err != nil {
			return err
		}
		if len(todayDone) != 1 || todayDone[0].Title != "今天买到" {
			t.Fatalf("当天已买到筛选错误：%v", taskTitles(todayDone))
		}

		first, err := objectService.AddOrMergeShoppingTaskInTx(
			ctx, q, userID, shoppingList.ID, "鸡蛋", "2 个", []string{"rcp_a"})
		if err != nil {
			return err
		}
		merged, err := objectService.AddOrMergeShoppingTaskInTx(
			ctx, q, userID, shoppingList.ID, "鸡蛋", "3 个", []string{"rcp_b"})
		if err != nil {
			return err
		}
		if merged.ID != first.ID || merged.QuantityText == nil || *merged.QuantityText != "2 个 + 3 个" {
			t.Fatalf("同名商品没有正确合并：%+v", merged)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func taskFixture(userID, listID, title string, completedAt *time.Time) dbgen.CreateTaskParams {
	status := "todo"
	if completedAt != nil {
		status = "done"
	}
	return dbgen.CreateTaskParams{
		ID: idgen.New(idgen.PrefixTask), UserID: userID, Title: title,
		Status: status, Priority: "normal", ListID: listID, Reminders: []byte("[]"),
		CompletedAt: completedAt, CreatedBy: "user", ProvenanceRefs: []byte("[]"),
	}
}

func taskTitles(tasks []dbgen.Task) []string {
	titles := make([]string, 0, len(tasks))
	for _, task := range tasks {
		titles = append(titles, task.Title)
	}
	return titles
}

func ptrTime(value time.Time) *time.Time { return &value }
