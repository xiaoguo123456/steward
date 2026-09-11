package views

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/users"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestDayAgendaWorkEventYesterdayAndToday(t *testing.T) {
	db := openTodayTestDB(t)
	userID := seedTodayTestUser(t, db)
	ctx := context.Background()
	loc := mustLoad(t, "Asia/Shanghai")
	start := time.Date(2026, 9, 11, 9, 30, 0, 0, loc)
	overdue := time.Date(2026, 9, 9, 0, 0, 0, 0, loc)
	zone := "Asia/Shanghai"
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		list, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "日汇总回归", ListKind: "tasks"})
		if err != nil {
			return err
		}
		_, err = q.CreateTask(ctx, dbgen.CreateTaskParams{ID: idgen.New(idgen.PrefixTask), UserID: userID, ListID: list.ID, Title: "逾期事项", Status: "todo", Priority: "normal", DueDate: &overdue, DueTimezone: &zone, Reminders: []byte("[]"), ProvenanceRefs: []byte("[]"), CreatedBy: "user"})
		if err != nil {
			return err
		}
		_, err = q.CreateEvent(ctx, dbgen.CreateEventParams{ID: idgen.New(idgen.PrefixEvent), UserID: userID, Title: "上班", EventKind: "schedule", StartAt: &start, Timezone: zone, Recurrence: "none", Participants: []byte("[]"), Reminders: []byte("[]"), ItineraryDetails: []byte("{}"), ProvenanceRefs: []byte("[]"), CreatedBy: "user"})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	svc := New(db, users.New(db, nil))
	for _, tc := range []struct {
		name                  string
		now                   time.Time
		offset, tasks, events int
		date                  string
	}{
		{"昨天今天只显示逾期", time.Date(2026, 9, 10, 15, 35, 0, 0, loc), 0, 1, 0, "2026-09-10"},
		{"昨天明天显示上班且不结转逾期", time.Date(2026, 9, 10, 15, 35, 0, 0, loc), 1, 0, 1, "2026-09-11"},
		{"今天上班开始后仍显示日程和逾期", time.Date(2026, 9, 11, 10, 0, 0, 0, loc), 0, 1, 1, "2026-09-11"},
		{"跨午夜后明天自动推进", time.Date(2026, 9, 11, 0, 0, 0, 0, loc), 1, 0, 0, "2026-09-12"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc.now = func() time.Time { return tc.now }
			got, err := svc.GetDayAgenda(ctx, userID, tc.offset)
			if err != nil {
				t.Fatal(err)
			}
			view := MapToday(got)
			if len(view.Tasks) != tc.tasks || len(view.Events) != tc.events || view.Date.String() != tc.date {
				t.Fatalf("日期、任务或日程不符：%+v", view)
			}
			if view.Counts.Total != tc.tasks {
				t.Fatal("旧 counts.total 必须保留任务语义，兼容旧客户端")
			}
		})
	}
}

func TestDayAgendaRejectsInvalidOffset(t *testing.T) {
	svc := New(nil, nil)
	for _, offset := range []int{-1, 2} {
		if _, err := svc.GetDayAgenda(context.Background(), "unused", offset); err == nil {
			t.Fatalf("必须拒绝偏移 %d", offset)
		}
	}
}

func TestDayAgendaTomorrowKeepsExplicitPlansWithoutPageLimit(t *testing.T) {
	db := openTodayTestDB(t)
	userID := seedTodayTestUser(t, db)
	ctx := context.Background()
	loc := mustLoad(t, "Asia/Shanghai")
	now := time.Date(2026, 9, 10, 15, 35, 0, 0, loc)
	tomorrow := time.Date(2026, 9, 11, 0, 0, 0, 0, loc)
	past := tomorrow.AddDate(0, 0, -2)
	early := tomorrow.Add(9 * time.Hour)
	zone := "Asia/Shanghai"
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		list, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{ID: idgen.New(idgen.PrefixTaskList), UserID: userID, Name: "完整按日汇总", ListKind: "tasks"})
		if err != nil {
			return err
		}
		add := func(title, status string, due, at, focus, scheduled *time.Time) error {
			var dueZone *string
			if due != nil || at != nil {
				dueZone = &zone
			}
			_, err := q.CreateTask(ctx, dbgen.CreateTaskParams{ID: idgen.New(idgen.PrefixTask), UserID: userID, ListID: list.ID, Title: title, Status: status, Priority: "normal", DueDate: due, DueTimezone: dueZone, DueAt: at, FocusDate: focus, ScheduledStartAt: scheduled, Reminders: []byte("[]"), ProvenanceRefs: []byte("[]"), CreatedBy: "user"})
			return err
		}
		for i := 0; i < 105; i++ {
			if err := add("明天截止", "todo", &tomorrow, nil, nil, nil); err != nil {
				return err
			}
		}
		for _, tc := range []struct {
			title, status             string
			due, at, focus, scheduled *time.Time
		}{
			{"明天早于当前钟点的截止", "todo", nil, &early, nil, nil},
			{"旧截止但明确加入明天", "todo", &past, nil, &tomorrow, nil},
			{"旧截止但明天有排期", "doing", &past, nil, nil, &early},
			{"已完成不计入", "done", &tomorrow, nil, nil, nil},
			{"已取消不计入", "cancelled", &tomorrow, nil, nil, nil},
			{"纯逾期不计入", "todo", &past, nil, nil, nil},
			{"无日期不计入", "todo", nil, nil, nil, nil},
		} {
			if err := add(tc.title, tc.status, tc.due, tc.at, tc.focus, tc.scheduled); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	svc := New(db, users.New(db, nil))
	svc.now = func() time.Time { return now }
	got, err := svc.GetDayAgenda(ctx, userID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tasks) != 108 {
		t.Fatalf("超过 100 项不得截断，应有 108 项，实际 %d", len(got.Tasks))
	}
	ranks := map[string]int32{}
	for _, task := range got.Tasks {
		ranks[task.Title] = task.GroupRank
	}
	for title, want := range map[string]int32{"明天早于当前钟点的截止": 1, "旧截止但明确加入明天": 3, "旧截止但明天有排期": 2} {
		if got, ok := ranks[title]; !ok || got != want {
			t.Fatalf("%s 分组应为 %d，实际 %d，存在 %v", title, want, got, ok)
		}
	}
}
