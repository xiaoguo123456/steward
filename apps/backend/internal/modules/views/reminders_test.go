package views

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

// 触发时刻的判定。这里全是确定性计算，不需要数据库。
//
// 重点在几个容易悄悄算错的地方：夏令时、闰日、跨年重复、过期窗口。
// 算错的后果不是报错而是「提醒没响」或者「半夜响了」，
// 两者都不会有人来报 bug，只会安静地让人不再信任这个功能。

func TestAbsoluteLocalFiresAtLocalTimeAcrossDST(t *testing.T) {
	// 伦敦 3 月 29 日进入夏令时。
	// 提醒定在「当天 09:00」，那就必须是当地 09:00——
	// 预先算成固定 UTC 偏移的实现会在这里错一小时。
	london := mustLoad(t, "Europe/London")

	winter := time.Date(2026, 2, 10, 0, 0, 0, 0, london)
	summer := time.Date(2026, 7, 10, 0, 0, 0, 0, london)

	for _, day := range []time.Time{winter, summer} {
		fireAt, ok := fireTimeFor(absoluteRule("r1", "09:00", 0), reminderTarget{
			Date: &day, Loc: london,
		})
		if !ok {
			t.Fatalf("%s 应当算得出触发时刻", day.Format("2006-01-02"))
		}
		got := fireAt.In(london)
		if got.Hour() != 9 || got.Minute() != 0 {
			t.Errorf("%s 应当在当地 09:00 触发，实际 %s",
				day.Format("2006-01-02"), got.Format("15:04 MST"))
		}
	}
}

func TestAbsoluteLocalDaysBeforeSubtractsInUserTimezone(t *testing.T) {
	shanghai := mustLoad(t, "Asia/Shanghai")
	day := time.Date(2026, 8, 20, 0, 0, 0, 0, shanghai)

	fireAt, ok := fireTimeFor(absoluteRule("r1", "09:00", 7), reminderTarget{
		Date: &day, Loc: shanghai,
	})
	if !ok {
		t.Fatal("应当算得出触发时刻")
	}
	got := fireAt.In(shanghai)
	if got.Format("2006-01-02 15:04") != "2026-08-13 09:00" {
		t.Errorf("提前 7 天应当是 08-13 09:00，实际 %s", got.Format("2006-01-02 15:04"))
	}
}

func TestRelativeNeedsAConcreteInstant(t *testing.T) {
	shanghai := mustLoad(t, "Asia/Shanghai")
	day := time.Date(2026, 8, 20, 0, 0, 0, 0, shanghai)

	// 全天事项没有「开始时刻」，提前 30 分钟无从算起。
	// 这条规则 objects 模块在写入时就拦掉了，这里是最后一道。
	if _, ok := fireTimeFor(relativeRule("r1", 30), reminderTarget{
		Date: &day, Loc: shanghai,
	}); ok {
		t.Error("全天事项不该接受相对提醒")
	}

	at := time.Date(2026, 8, 20, 14, 0, 0, 0, shanghai)
	fireAt, ok := fireTimeFor(relativeRule("r1", 30), reminderTarget{
		At: &at, Loc: shanghai,
	})
	if !ok {
		t.Fatal("有具体时刻时应当算得出")
	}
	if got := fireAt.In(shanghai).Format("15:04"); got != "13:30" {
		t.Errorf("14:00 提前 30 分钟应当是 13:30，实际 %s", got)
	}
}

func TestStaleIsMeasuredFromTheEventNotTheFireTime(t *testing.T) {
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name     string
		fireAt   time.Time
		eventEnd time.Time
		want     bool
	}{
		{"还没到点", now.Add(time.Hour), now.Add(2 * time.Hour), false},
		{"刚到点", now, now.Add(time.Hour), true},
		{
			// 这条是关键：提醒早就响过了，但事件还没到。
			// 按「响过多久」判过期会把最该看到的提醒吞掉。
			name:   "提前七天的提醒响过五天，事件还有两天才到",
			fireAt: now.Add(-5 * 24 * time.Hour), eventEnd: now.Add(2 * 24 * time.Hour),
			want: true,
		},
		{
			name:   "事件过去一天，仍值得补救",
			fireAt: now.Add(-8 * 24 * time.Hour), eventEnd: now.Add(-24 * time.Hour),
			want: true,
		},
		{
			name:   "事件正好过去三天",
			fireAt: now.Add(-10 * 24 * time.Hour), eventEnd: now.Add(-StaleWindow),
			want: true,
		},
		{
			// 生日过了一周再弹「明天是妈妈生日」是伤害不是帮助。
			name:   "事件过去超过窗口",
			fireAt: now.Add(-10 * 24 * time.Hour), eventEnd: now.Add(-StaleWindow - time.Minute),
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDue(tc.fireAt, tc.eventEnd, now); got != tc.want {
				t.Errorf("期望 %v，实际 %v", tc.want, got)
			}
		})
	}
}

func TestYearlyEventProjectsToCurrentYear(t *testing.T) {
	shanghai := mustLoad(t, "Asia/Shanghai")
	// 生日存的是 1990 年那天，提醒要按今年算。
	born := time.Date(1990, 8, 22, 0, 0, 0, 0, shanghai)
	row := yearlyEvent("evt_1", "妈妈生日", born, "Asia/Shanghai",
		absoluteRule("r1", "09:00", 7))

	// 提前 7 天 = 8 月 15 日 09:00 响，此刻 8 月 20 日：
	// 提醒响过 5 天了，但生日还有 2 天才到，仍然该显示。
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, shanghai)
	due := eventReminders(row, now)

	if len(due) != 1 {
		t.Fatalf("应当有 1 条待提醒，实际 %d 条", len(due))
	}
	if got := due[0].OccurrenceDate.Format("2006-01-02"); got != "2026-08-22" {
		t.Errorf("这次发生应当投影到今年，实际 %s", got)
	}
	if got := due[0].FireAt.In(shanghai).Format("2006-01-02 15:04"); got != "2026-08-15 09:00" {
		t.Errorf("触发时刻应当是 08-15 09:00，实际 %s", got)
	}
}

func TestYearlyEventAcrossNewYear(t *testing.T) {
	shanghai := mustLoad(t, "Asia/Shanghai")
	// 12 月 28 日的纪念日，提前 7 天 = 12 月 21 日。
	// 用户 1 月 2 日才打开 App——那次提醒早就超窗了，不该再弹。
	born := time.Date(2000, 12, 28, 0, 0, 0, 0, shanghai)
	row := yearlyEvent("evt_1", "纪念日", born, "Asia/Shanghai",
		absoluteRule("r1", "09:00", 7))

	// 1 月 2 日：12-28 那次已经过去 5 天，超窗，不该再打扰。
	now := time.Date(2026, 1, 2, 10, 0, 0, 0, shanghai)
	if due := eventReminders(row, now); len(due) != 0 {
		t.Errorf("纪念日已过去 5 天，超窗不该再提醒，实际 %d 条", len(due))
	}

	// 12 月 30 日：纪念日刚过去 2 天，还在窗口内。
	// 这一条同时验证了跨年查找——now 在今年，而这次发生也在今年。
	now = time.Date(2025, 12, 30, 10, 0, 0, 0, shanghai)
	due := eventReminders(row, now)
	if len(due) != 1 {
		t.Fatalf("纪念日刚过 2 天，应当仍提醒，实际 %d 条", len(due))
	}
	if got := due[0].OccurrenceDate.Format("2006-01-02"); got != "2025-12-28" {
		t.Errorf("这次发生应当是 2025-12-28，实际 %s", got)
	}

	// 1 月 3 日看去年 12 月 31 日的纪念日：这次发生在去年，
	// 只投影当年会漏掉它。
	newYearEve := time.Date(2000, 12, 31, 0, 0, 0, 0, shanghai)
	crossing := yearlyEvent("evt_2", "跨年纪念", newYearEve, "Asia/Shanghai",
		absoluteRule("r1", "09:00", 0))
	now = time.Date(2026, 1, 2, 10, 0, 0, 0, shanghai)
	if due := eventReminders(crossing, now); len(due) != 1 {
		t.Errorf("去年 12-31 那次刚过 2 天，应当仍提醒，实际 %d 条", len(due))
	}
}

func TestYearlyLeapDayFallsBackInCommonYear(t *testing.T) {
	shanghai := mustLoad(t, "Asia/Shanghai")
	// 2 月 29 日出生。2026 年不是闰年，这次发生要落在 2 月 28 日。
	born := time.Date(2000, 2, 29, 0, 0, 0, 0, shanghai)
	row := yearlyEvent("evt_1", "闰日生日", born, "Asia/Shanghai",
		absoluteRule("r1", "09:00", 0))

	now := time.Date(2026, 2, 28, 10, 0, 0, 0, shanghai)
	due := eventReminders(row, now)
	if len(due) != 1 {
		t.Fatalf("应当有 1 条，实际 %d 条", len(due))
	}
	if got := due[0].OccurrenceDate.Format("2006-01-02"); got != "2026-02-28" {
		t.Errorf("平年应当退到 02-28，实际 %s", got)
	}
}

func TestTaskReminderUsesDueTimezoneNotUserTimezone(t *testing.T) {
	// 一件「北京时间周五 18:00 前交」的事，用户飞到伦敦之后
	// 仍然是那个时刻——截止语义带着它自己的时区。
	shanghai := mustLoad(t, "Asia/Shanghai")
	dueAt := time.Date(2026, 8, 20, 18, 0, 0, 0, shanghai)
	tz := "Asia/Shanghai"

	row := dbgen.ListTasksWithRemindersRow{
		ID: "tsk_1", Title: "交季度报告",
		DueAt: &dueAt, DueTimezone: &tz,
		Reminders: encodeRules(t, relativeRule("r1", 60)),
	}

	now := time.Date(2026, 8, 20, 17, 30, 0, 0, shanghai)
	due := taskReminders(row, "Europe/London", now)
	if len(due) != 1 {
		t.Fatalf("应当有 1 条，实际 %d 条", len(due))
	}
	if got := due[0].FireAt.In(shanghai).Format("15:04"); got != "17:00" {
		t.Errorf("18:00 提前 1 小时应当是北京时间 17:00，实际 %s", got)
	}
}

func TestDueReminderIDIsStableAndReadable(t *testing.T) {
	// 复合键要能一眼读出是哪条提醒：出问题时不用先解码再排查。
	// 它也必须稳定——客户端拿它来消掉提醒。
	got := dueReminderID("evt_1", "rmd_2", "2026-08-22")
	if got != "evt_1|rmd_2|2026-08-22" {
		t.Errorf("复合键格式变了：%s", got)
	}
}

// ---- 辅助 ----

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("加载时区 %s 失败：%v", name, err)
	}
	return loc
}

func absoluteRule(id, localTime string, daysBefore int) httpapi.Reminder {
	return httpapi.Reminder{
		Id: id, Kind: httpapi.ReminderKindAbsoluteLocal,
		LocalTime: &localTime, DaysBefore: &daysBefore,
	}
}

func relativeRule(id string, offsetMinutes int) httpapi.Reminder {
	return httpapi.Reminder{
		Id: id, Kind: httpapi.ReminderKindRelative,
		OffsetMinutes: &offsetMinutes,
	}
}

func encodeRules(t *testing.T, rules ...httpapi.Reminder) []byte {
	t.Helper()
	raw, err := json.Marshal(rules)
	if err != nil {
		t.Fatalf("编码提醒失败：%v", err)
	}
	return raw
}

func yearlyEvent(id, title string, date time.Time, tz string,
	rules ...httpapi.Reminder) dbgen.ListEventsWithRemindersRow {

	return dbgen.ListEventsWithRemindersRow{
		ID: id, Title: title, AllDay: true,
		StartDate: &date, Timezone: tz,
		Recurrence: "yearly", EventKind: "important_date",
		Reminders: encodeRulesRaw(rules),
	}
}

func encodeRulesRaw(rules []httpapi.Reminder) []byte {
	raw, _ := json.Marshal(rules)
	return raw
}
