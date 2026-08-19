package timeutil

import (
	"testing"
	"time"
)

func TestDayOfHandlesTimezone(t *testing.T) {
	shanghai := LoadLocation("Asia/Shanghai")
	// UTC 的 2026-08-19 17:00 在上海已经是 8 月 20 日。
	utcEvening := time.Date(2026, 8, 19, 17, 0, 0, 0, time.UTC)

	day := DayOf(utcEvening, shanghai)
	if got := FormatDate(day.Date); got != "2026-08-20" {
		t.Errorf("期望 2026-08-20，实际 %s", got)
	}
	if day.End.Sub(day.Start) < 23*time.Hour {
		t.Errorf("一天的跨度不应小于 23 小时，实际 %v", day.End.Sub(day.Start))
	}
}

func TestLoadLocationFallsBackOnInvalidInput(t *testing.T) {
	// 时区来自客户端，属于不可信输入：非法值必须回退而不是让请求失败。
	loc := LoadLocation("Not/A_Zone")
	if loc == nil {
		t.Fatal("回退后不应返回 nil")
	}
	if loc.String() != DefaultTimezone && loc != time.UTC {
		t.Errorf("期望回退到默认时区或 UTC，实际 %s", loc)
	}
}

func TestIsOverdueUsesDateSemanticsForDueDate(t *testing.T) {
	shanghai := "Asia/Shanghai"
	loc := LoadLocation(shanghai)
	dueDate := time.Date(2026, 8, 19, 0, 0, 0, 0, loc)

	cases := []struct {
		name string
		now  time.Time
		want bool
	}{
		{
			// “今天截止”在当天任何时刻都不算逾期，不能被补成 23:59 之前才算。
			name: "当天上午不算逾期",
			now:  time.Date(2026, 8, 19, 9, 0, 0, 0, loc),
			want: false,
		},
		{
			name: "当天深夜仍不算逾期",
			now:  time.Date(2026, 8, 19, 23, 59, 0, 0, loc),
			want: false,
		},
		{
			name: "越过当地日期边界后才算逾期",
			now:  time.Date(2026, 8, 20, 0, 1, 0, 0, loc),
			want: true,
		},
		{
			// 用户飞到别处不改变原截止日的事实语义：
			// 13:00 UTC 在上海是当天 21:00，仍未越过 8 月 19 日。
			name: "换算到截止时区仍在当天",
			now:  time.Date(2026, 8, 19, 13, 0, 0, 0, time.UTC),
			want: false,
		},
		{
			// 20:00 UTC 在上海已是 8 月 20 日凌晨，越过了原截止日。
			name: "换算到截止时区已跨天",
			now:  time.Date(2026, 8, 19, 20, 0, 0, 0, time.UTC),
			want: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsOverdue(&dueDate, nil, shanghai, tc.now); got != tc.want {
				t.Errorf("期望 %v，实际 %v", tc.want, got)
			}
		})
	}
}

func TestIsOverdueUsesInstantForDueAt(t *testing.T) {
	loc := LoadLocation("Asia/Shanghai")
	dueAt := time.Date(2026, 8, 19, 10, 0, 0, 0, loc)

	if IsOverdue(nil, &dueAt, "Asia/Shanghai", dueAt.Add(-time.Minute)) {
		t.Error("到点之前不应算逾期")
	}
	if !IsOverdue(nil, &dueAt, "Asia/Shanghai", dueAt.Add(time.Minute)) {
		t.Error("过了时刻应算逾期")
	}
}

func TestWeekBounds(t *testing.T) {
	loc := LoadLocation("Asia/Shanghai")
	// 2026-08-19 是星期三。
	wednesday := time.Date(2026, 8, 19, 12, 0, 0, 0, loc)

	start, end := WeekBounds(wednesday, loc, "monday")
	if FormatDate(start) != "2026-08-17" || FormatDate(end) != "2026-08-23" {
		t.Errorf("周一起始：期望 08-17 ~ 08-23，实际 %s ~ %s", FormatDate(start), FormatDate(end))
	}

	start, end = WeekBounds(wednesday, loc, "sunday")
	if FormatDate(start) != "2026-08-16" || FormatDate(end) != "2026-08-22" {
		t.Errorf("周日起始：期望 08-16 ~ 08-22，实际 %s ~ %s", FormatDate(start), FormatDate(end))
	}
}

func TestProjectYearlyHandlesLeapDay(t *testing.T) {
	loc := LoadLocation("Asia/Shanghai")

	// 闰年保持 2 月 29 日。
	if got := FormatDate(ProjectYearly(time.February, 29, 2028, loc)); got != "2028-02-29" {
		t.Errorf("闰年期望 2028-02-29，实际 %s", got)
	}
	// 非闰年落到 2 月 28 日；原始月日由调用方单独保留。
	if got := FormatDate(ProjectYearly(time.February, 29, 2027, loc)); got != "2027-02-28" {
		t.Errorf("非闰年期望 2027-02-28，实际 %s", got)
	}
	// 世纪年规则：2100 不是闰年。
	if got := FormatDate(ProjectYearly(time.February, 29, 2100, loc)); got != "2100-02-28" {
		t.Errorf("2100 年期望 2100-02-28，实际 %s", got)
	}
	if got := FormatDate(ProjectYearly(time.August, 24, 2027, loc)); got != "2027-08-24" {
		t.Errorf("普通日期期望 2027-08-24，实际 %s", got)
	}
}

func TestParseLocalTime(t *testing.T) {
	hour, minute, err := ParseLocalTime("09:30")
	if err != nil || hour != 9 || minute != 30 {
		t.Errorf("期望 9:30，实际 %d:%d err=%v", hour, minute, err)
	}
	if _, _, err := ParseLocalTime("25:00"); err == nil {
		t.Error("非法时刻应当报错")
	}
}
