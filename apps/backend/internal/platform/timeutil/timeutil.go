// Package timeutil 实现全部时间语义。
//
// 功能规格要求时间与日期规则只由服务端确定性代码决定：
// due_date 表示“某一天截止”而不是当天 23:59；
// 用户旅行换时区不改变原截止日的事实语义；
// 重要日按月日每年重复，2 月 29 日在非闰年落到 2 月 28 日。
package timeutil

import (
	"fmt"
	"time"
)

// DefaultTimezone 是用户未设置时区时的兜底值。
const DefaultTimezone = "Asia/Shanghai"

// LoadLocation 解析 IANA 时区名，非法值回退到默认时区。
// 用户资料里的时区来自客户端，属于不可信输入，因此不允许因此让请求失败。
func LoadLocation(name string) *time.Location {
	if name == "" {
		name = DefaultTimezone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		if fallback, err2 := time.LoadLocation(DefaultTimezone); err2 == nil {
			return fallback
		}
		return time.UTC
	}
	return loc
}

// Day 描述某个时区下的一整天。
type Day struct {
	// Date 是该时区的当地日期，时分秒为零，Location 为该时区。
	Date time.Time
	// Start 是当地 00:00:00。
	Start time.Time
	// End 是当地当天的最后一刻，用于闭区间比较。
	End time.Time
}

// DayOf 返回 t 在 loc 下所属的一整天。
func DayOf(t time.Time, loc *time.Location) Day {
	local := t.In(loc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return Day{
		Date:  start,
		Start: start,
		// 用下一天减 1 纳秒，正确处理夏令时导致的 23 小时或 25 小时的一天。
		End: start.AddDate(0, 0, 1).Add(-time.Nanosecond),
	}
}

// DateOf 返回 t 在 loc 下的当地日期（零时分秒）。
func DateOf(t time.Time, loc *time.Location) time.Time {
	return DayOf(t, loc).Date
}

// ParseDate 解析 YYYY-MM-DD 为指定时区当天零点。
func ParseDate(s string, loc *time.Location) (time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02", s, loc)
	if err != nil {
		return time.Time{}, fmt.Errorf("日期格式必须为 YYYY-MM-DD：%w", err)
	}
	return t, nil
}

// FormatDate 输出 YYYY-MM-DD。
func FormatDate(t time.Time) string {
	return t.Format("2006-01-02")
}

// IsOverdue 判断一个截止语义在当前时刻是否已逾期。
//
// dueDate 只精确到日：只有越过该时区的当天结束边界才算逾期，
// 因此“今天截止”的任务在当天任何时刻都不是逾期状态。
// dueAt 精确到时刻：过了该时刻即为逾期。
func IsOverdue(dueDate *time.Time, dueAt *time.Time, dueTimezone string, now time.Time) bool {
	if dueAt != nil {
		return dueAt.Before(now)
	}
	if dueDate != nil {
		loc := LoadLocation(dueTimezone)
		// 把 due_date 解释为它所属时区的当天，再看是否已经越过当天结束。
		day := DayOf(time.Date(dueDate.Year(), dueDate.Month(), dueDate.Day(), 12, 0, 0, 0, loc), loc)
		return now.After(day.End)
	}
	return false
}

// WeekBounds 返回包含 date 的自然周的起止日期（闭区间）。
// weekStart 取 monday 或 sunday，来自用户显式偏好。
func WeekBounds(date time.Time, loc *time.Location, weekStart string) (start, end time.Time) {
	d := DateOf(date, loc)
	weekday := int(d.Weekday()) // 周日为 0
	var offset int
	if weekStart == "sunday" {
		offset = weekday
	} else {
		// 周一为一周开始时，周日需要回退 6 天。
		offset = (weekday + 6) % 7
	}
	start = d.AddDate(0, 0, -offset)
	end = start.AddDate(0, 0, 6)
	return start, end
}

// ProjectYearly 把一个按年重复的月日投影到指定年份。
//
// 2 月 29 日在非闰年落到 2 月 28 日；详情页仍展示原始月日，
// 因此调用方需要单独保留 original_month_day。
func ProjectYearly(month time.Month, day int, year int, loc *time.Location) time.Time {
	if month == time.February && day == 29 && !isLeapYear(year) {
		day = 28
	}
	return time.Date(year, month, day, 0, 0, 0, 0, loc)
}

func isLeapYear(year int) bool {
	return (year%4 == 0 && year%100 != 0) || year%400 == 0
}

// MonthDay 把日期格式化为 MM-DD，用于保存重要日的原始月日。
func MonthDay(t time.Time) string {
	return t.Format("01-02")
}

// ParseMonthDay 解析 MM-DD。
func ParseMonthDay(s string) (time.Month, int, error) {
	t, err := time.Parse("01-02", s)
	if err != nil {
		return 0, 0, fmt.Errorf("月日格式必须为 MM-DD：%w", err)
	}
	return t.Month(), t.Day(), nil
}

// ParseLocalTime 解析 HH:MM 形式的当地时刻。
func ParseLocalTime(s string) (hour, minute int, err error) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0, fmt.Errorf("时刻格式必须为 HH:MM：%w", err)
	}
	return t.Hour(), t.Minute(), nil
}
