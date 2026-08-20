package views

import (
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 待提醒的判定。
//
// 提醒不是一张表里的行：它是事项上的一条规则，加上一次「发生」算出来的时刻。
// 因此每次都要现算——用户改了时区、改了截止日期、把事项删了，
// 算出来的结果立刻就跟着变，不需要去清理任何预先排好的东西。
//
// 这里全是纯函数，reminders_test.go 覆盖了时区、夏令时、闰日与年度重复。

// StaleWindow 是**事件本身**过去多久之后不再打扰用户。
//
// 注意是从事件算，不是从提醒响的时刻算。一条「提前 7 天」的生日提醒
// 在 8/15 响，用户 8/20 才打开 App——生日还没到，这条提醒完全有效，
// 按「响过 5 天了」判过期会把最该看到的提醒吞掉。
//
// 生日过了一周再弹「明天是妈妈生日」才是伤害；但一两天内补救仍有意义，
// 迟到的祝福好过没有。超窗之后数据仍在，重要日列表里随时看得到，
// 只是不再主动浮出来。
const StaleWindow = 3 * 24 * time.Hour

// DueReminder 是一条到点了、用户还没处理的提醒。
type DueReminder struct {
	// ID 是可读的复合键：来源 ID、规则 ID 与这次发生的日期。
	//
	// 用可读的而不是不透明编码：出问题时从日志里一眼能看出是哪条提醒，
	// 而它本来就是由这三段唯一确定的。
	ID             string
	SourceType     string
	SourceID       string
	ReminderID     string
	OccurrenceDate time.Time
	Title          string
	// FireAt 是这条提醒该响的时刻。
	FireAt time.Time
	// EventKind 让客户端区分重要日与普通日程，为空表示来源是任务。
	EventKind string
}

// dueReminderID 拼出复合键。分隔符用 | ：ID 里不会出现它。
func dueReminderID(sourceID, reminderID, occurrence string) string {
	return sourceID + "|" + reminderID + "|" + occurrence
}

// taskReminders 算出一个任务的全部到期提醒。
//
// 任务只有一次发生：它的截止时间。没有截止信息的任务不允许设提醒
// （objects 模块在写入时就拦掉了），所以这里不必处理那种情况。
func taskReminders(row dbgen.ListTasksWithRemindersRow, userTZ string, now time.Time) []DueReminder {
	tz := userTZ
	if row.DueTimezone != nil && *row.DueTimezone != "" {
		// 截止语义带着它自己的时区：一件「在北京时间周五前交」的事，
		// 用户飞到伦敦之后仍然是那个时刻。
		tz = *row.DueTimezone
	}
	loc := timeutil.LoadLocation(tz)

	var out []DueReminder
	for _, rule := range decodeReminders(row.Reminders) {
		target := reminderTarget{At: row.DueAt, Date: row.DueDate, Loc: loc}
		fireAt, ok := fireTimeFor(rule, target)
		if !ok || !isDue(fireAt, eventEndOf(target), now) {
			continue
		}
		occurrence := occurrenceOf(row.DueAt, row.DueDate, loc)
		out = append(out, DueReminder{
			ID:             dueReminderID(row.ID, rule.Id, timeutil.FormatDate(occurrence)),
			SourceType:     "task",
			SourceID:       row.ID,
			ReminderID:     rule.Id,
			OccurrenceDate: occurrence,
			Title:          row.Title,
			FireAt:         fireAt,
		})
	}
	return out
}

// eventReminders 算出一个日程的全部到期提醒。
//
// 重要日（recurrence=yearly）每年发生一次，要投影到当年；
// 而且要考虑「今年的已经过了、该看明年的了」这种情况。
func eventReminders(row dbgen.ListEventsWithRemindersRow, now time.Time) []DueReminder {
	loc := timeutil.LoadLocation(row.Timezone)

	var out []DueReminder
	for _, rule := range decodeReminders(row.Reminders) {
		for _, occurrence := range eventOccurrences(row, loc, now) {
			target := reminderTarget{Loc: loc}
			if row.AllDay || row.StartAt == nil {
				date := occurrence
				target.Date = &date
			} else {
				at := occurrence
				target.At = &at
			}

			fireAt, ok := fireTimeFor(rule, target)
			if !ok || !isDue(fireAt, eventEndOf(target), now) {
				continue
			}
			out = append(out, DueReminder{
				ID:             dueReminderID(row.ID, rule.Id, timeutil.FormatDate(occurrence)),
				SourceType:     "event",
				SourceID:       row.ID,
				ReminderID:     rule.Id,
				OccurrenceDate: timeutil.DateOf(occurrence, loc),
				Title:          row.Title,
				FireAt:         fireAt,
				EventKind:      row.EventKind,
			})
		}
	}
	return out
}

// eventOccurrences 给出这个日程需要考虑的发生时刻。
//
// 不重复的只有一次。每年重复的要看今年和去年两次：
// 用户可能在 1 月初打开 App，而去年 12 月底那次的提醒还在窗口内。
func eventOccurrences(row dbgen.ListEventsWithRemindersRow, loc *time.Location, now time.Time) []time.Time {
	if row.Recurrence != "yearly" || row.StartDate == nil {
		if row.StartAt != nil {
			return []time.Time{*row.StartAt}
		}
		if row.StartDate != nil {
			return []time.Time{*row.StartDate}
		}
		return nil
	}

	base := *row.StartDate
	year := now.In(loc).Year()
	return []time.Time{
		timeutil.ProjectYearly(base.Month(), base.Day(), year, loc),
		timeutil.ProjectYearly(base.Month(), base.Day(), year-1, loc),
	}
}

// reminderTarget 是提醒所指向的那个时间点。
//
// At 与 Date 二选一：有具体时刻的用 At，全天的用 Date。
type reminderTarget struct {
	At   *time.Time
	Date *time.Time
	Loc  *time.Location
}

// fireTimeFor 算出一条提醒规则该响的时刻。
//
// 两种语义不能混：
//   - relative 是「开始前 N 分钟」，只对有具体时刻的事项有意义。
//     全天事项没有「开始时刻」，提前 30 分钟无从算起。
//   - absolute_local 是「提前几天的当地某点」，因此必须在用户时区里构造，
//     不能预先算成 UTC 存起来——跨过夏令时切换就会偏一小时。
func fireTimeFor(rule httpapi.Reminder, target reminderTarget) (time.Time, bool) {
	switch rule.Kind {
	case httpapi.ReminderKindRelative:
		if target.At == nil || rule.OffsetMinutes == nil {
			return time.Time{}, false
		}
		return target.At.Add(-time.Duration(*rule.OffsetMinutes) * time.Minute), true

	case httpapi.ReminderKindAbsoluteLocal:
		if rule.LocalTime == nil {
			return time.Time{}, false
		}
		hour, minute, err := timeutil.ParseLocalTime(*rule.LocalTime)
		if err != nil {
			return time.Time{}, false
		}

		// 基准日：有具体时刻的取它当天，全天的直接用那一天。
		var day time.Time
		switch {
		case target.Date != nil:
			day = timeutil.DateOf(*target.Date, target.Loc)
		case target.At != nil:
			day = timeutil.DateOf(*target.At, target.Loc)
		default:
			return time.Time{}, false
		}

		daysBefore := 0
		if rule.DaysBefore != nil {
			daysBefore = *rule.DaysBefore
		}
		// 先退天数再拼时刻，都在用户时区里做。
		// 反过来（先拼 UTC 再减）会在夏令时边界上错一小时。
		fireDay := day.AddDate(0, 0, -daysBefore)
		return time.Date(fireDay.Year(), fireDay.Month(), fireDay.Day(),
			hour, minute, 0, 0, target.Loc), true
	}
	return time.Time{}, false
}

// isDue 判断一条提醒此刻是否该浮出来。
//
// 两个条件：提醒已经到点，且**事件本身**还没过去太久。
// 第二个条件用事件而不是提醒时刻，见 StaleWindow 的说明。
func isDue(fireAt, eventEnd, now time.Time) bool {
	if fireAt.After(now) {
		return false
	}
	return now.Sub(eventEnd) <= StaleWindow
}

// eventEndOf 给出事件「结束」的时刻，用于判断它是否已经过去太久。
//
// 全天事项按当地那天的结束算：8 月 22 日的生日，在 8 月 22 日一整天里
// 都不算「过去了」。
func eventEndOf(target reminderTarget) time.Time {
	if target.Date != nil {
		day := timeutil.DateOf(*target.Date, target.Loc)
		return day.AddDate(0, 0, 1)
	}
	if target.At != nil {
		return *target.At
	}
	return time.Time{}
}

// occurrenceOf 给出任务这一次发生的日期，用于去重键。
func occurrenceOf(at, date *time.Time, loc *time.Location) time.Time {
	if date != nil {
		return timeutil.DateOf(*date, loc)
	}
	if at != nil {
		return timeutil.DateOf(*at, loc)
	}
	return time.Time{}
}

func decodeReminders(raw []byte) []httpapi.Reminder {
	var out []httpapi.Reminder
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}
