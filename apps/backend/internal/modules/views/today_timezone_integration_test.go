package views

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

func TestListTodayTasksUsesEachDueTimezone(t *testing.T) {
	db := openTodayTestDB(t)
	userID := seedTodayTestUser(t, db)
	now := time.Date(2026, 9, 1, 16, 30, 0, 0, time.UTC)
	dueDate := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	futureDate := dueDate.AddDate(0, 0, 1)

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		list, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "默认清单",
			Position: 0, IsDefault: true, ListKind: "tasks",
		})
		if err != nil {
			return err
		}
		for _, fixture := range []struct {
			title string
			date  time.Time
			zone  string
		}{
			// 同一绝对时刻，Kiritimati 已进入 9 月 2 日，9 月 1 日截止已逾期。
			{title: "基里蒂马蒂已逾期", date: dueDate, zone: "Pacific/Kiritimati"},
			// Honolulu 仍是 9 月 1 日，同一截止日期只属于今天截止。
			{title: "檀香山今天截止", date: dueDate, zone: "Pacific/Honolulu"},
			{title: "檀香山尚未截止", date: futureDate, zone: "Pacific/Honolulu"},
		} {
			zone := fixture.zone
			if _, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
				ID: idgen.New(idgen.PrefixTask), UserID: userID, Title: fixture.title,
				Status: "todo", Priority: "normal", DueDate: &fixture.date, DueTimezone: &zone,
				ListID: list.ID, Reminders: []byte("[]"), CreatedBy: "user", ProvenanceRefs: []byte("[]"),
			}); err != nil {
				return err
			}
		}

		userDay := timeutil.DayOf(now, timeutil.LoadLocation("Asia/Shanghai"))
		rows, err := q.ListTodayTasks(ctx, dbgen.ListTodayTasksParams{
			Tz: "Asia/Shanghai", Today: userDay.Date, NowAt: now,
			DayStart: userDay.Start, DayEnd: userDay.End,
		})
		if err != nil {
			return err
		}
		if len(rows) != 2 {
			t.Fatalf("应收录两条已到截止日期的任务，实际：%v", todayTaskTitles(rows))
		}
		if rows[0].Title != "基里蒂马蒂已逾期" || rows[0].GroupRank != 0 {
			t.Fatalf("第一条应按任务时区归入已逾期，实际：%+v", rows[0])
		}
		if rows[1].Title != "檀香山今天截止" || rows[1].GroupRank != 1 {
			t.Fatalf("第二条应按任务时区归入今天截止，实际：%+v", rows[1])
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func openTodayTestDB(t *testing.T) *database.DB {
	t.Helper()
	databaseURL := config.LoadForTest().DatabaseURL
	if databaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过 Today 时区集成测试")
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

func seedTodayTestUser(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := fmt.Sprintf("16%09d", time.Now().UnixNano()%1_000_000_000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "Today 时区测试", "Asia/Shanghai").Scan(&userID)
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

func todayTaskTitles(rows []dbgen.ListTodayTasksRow) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Title)
	}
	return out
}
