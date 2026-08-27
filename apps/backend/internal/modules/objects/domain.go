// Package objects 拥有 Task、Event、Project 与 Note。
//
// 这四类实体共享通用字段（来源、软删除、版本）与同一套时间语义，
// 因此放在同一个模块内；它们的状态机、截止语义与校验规则只在这里实现，
// 客户端的任何同类逻辑都只是非权威展示。
package objects

import (
	"encoding/json"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// emptyJSONArray 是 jsonb 数组列的默认值。
var emptyJSONArray = []byte("[]")

// marshalJSON 把任意值编码为 jsonb 列内容，nil 与空切片统一为 []。
func marshalJSON(v any) ([]byte, error) {
	if v == nil {
		return emptyJSONArray, nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if len(raw) == 0 || string(raw) == "null" {
		return emptyJSONArray, nil
	}
	return raw, nil
}

// unmarshalProvenance 解析来源引用列。
func unmarshalProvenance(raw []byte) *[]httpapi.ProvenanceRef {
	if len(raw) == 0 {
		return nil
	}
	var refs []httpapi.ProvenanceRef
	if err := json.Unmarshal(raw, &refs); err != nil || len(refs) == 0 {
		return nil
	}
	return &refs
}

// unmarshalReminders 解析提醒列。
func unmarshalReminders(raw []byte) *[]httpapi.Reminder {
	if len(raw) == 0 {
		return nil
	}
	var reminders []httpapi.Reminder
	if err := json.Unmarshal(raw, &reminders); err != nil || len(reminders) == 0 {
		return nil
	}
	return &reminders
}

// unmarshalStrings 解析字符串数组列，例如 participants。
func unmarshalStrings(raw []byte) *[]string {
	if len(raw) == 0 {
		return nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil || len(out) == 0 {
		return nil
	}
	return &out
}

// buildReminders 把输入的提醒转换成带 ID 的存储结构，并校验字段组合。
//
// 规则来自功能规格：相对提醒只能用于有明确时刻的事项；
// 全天 Event 与只有 due_date 的 Task 必须使用明确的当地触发时间。
func buildReminders(inputs *[]httpapi.ReminderInput, allowRelative bool) ([]httpapi.Reminder, error) {
	if inputs == nil || len(*inputs) == 0 {
		return nil, nil
	}
	out := make([]httpapi.Reminder, 0, len(*inputs))
	for i, in := range *inputs {
		switch in.Kind {
		case httpapi.ReminderInputKindRelative:
			if !allowRelative {
				return nil, apperr.Validation(apperr.Field(
					"reminders",
					"没有具体时刻的事项必须使用明确的当地提醒时间，不能使用“开始前若干分钟”。"))
			}
			if in.OffsetMinutes == nil {
				return nil, apperr.Validation(apperr.Field(
					"reminders", "相对提醒必须提供 offset_minutes。"))
			}
			out = append(out, httpapi.Reminder{
				Id:            idgen.New(idgen.PrefixReminder),
				Kind:          httpapi.ReminderKindRelative,
				OffsetMinutes: in.OffsetMinutes,
			})
		case httpapi.ReminderInputKindAbsoluteLocal:
			if in.LocalTime == nil {
				return nil, apperr.Validation(apperr.Field(
					"reminders", "当地提醒必须提供 local_time。"))
			}
			if _, _, err := timeutil.ParseLocalTime(*in.LocalTime); err != nil {
				return nil, apperr.Validation(apperr.Field(
					"reminders", "local_time 必须是 HH:MM 格式。"))
			}
			daysBefore := 0
			if in.DaysBefore != nil {
				daysBefore = *in.DaysBefore
			}
			out = append(out, httpapi.Reminder{
				Id:         idgen.New(idgen.PrefixReminder),
				Kind:       httpapi.ReminderKindAbsoluteLocal,
				LocalTime:  in.LocalTime,
				DaysBefore: &daysBefore,
			})
		default:
			_ = i
			return nil, apperr.Validation(apperr.Field("reminders", "提醒类型不合法。"))
		}
	}
	return out, nil
}

// validateTaskStatusTransition 校验 Task 状态转换。
//
// todo/doing 可以互转并走向 done 或 cancelled；
// done 或 cancelled 重新打开后统一回到 todo。
func validateTaskStatusTransition(from, to string) error {
	if from == to {
		return nil
	}
	allowed := map[string][]string{
		"todo":      {"doing", "done", "cancelled"},
		"doing":     {"todo", "done", "cancelled"},
		"done":      {"todo"},
		"cancelled": {"todo"},
	}
	for _, candidate := range allowed[from] {
		if candidate == to {
			return nil
		}
	}
	return apperr.Newf(apperr.CodeTaskStatusInvalid,
		"不能把状态从“%s”直接改为“%s”。", statusLabel(from), statusLabel(to))
}

func statusLabel(status string) string {
	switch status {
	case "todo":
		return "待办"
	case "doing":
		return "进行中"
	case "done":
		return "已完成"
	case "cancelled":
		return "已取消"
	default:
		return status
	}
}

// validateProjectStatusTransition 校验 Project 状态转换。
func validateProjectStatusTransition(from, to string) error {
	if from == to {
		return nil
	}
	allowed := map[string][]string{
		"active":    {"paused", "completed", "archived"},
		"paused":    {"active", "completed", "archived"},
		"completed": {"active", "archived"},
		// 归档恢复由服务端按 status_before_archived 还原，这里允许回到任一非归档态。
		"archived": {"active", "paused", "completed"},
	}
	for _, candidate := range allowed[from] {
		if candidate == to {
			return nil
		}
	}
	return apperr.Newf(apperr.CodeTaskStatusInvalid,
		"项目不能从“%s”直接变为“%s”。", from, to)
}

// projectStatusChange 描述一次 Project 状态变更的输入。
type projectStatusChange struct {
	// From 是当前状态，Requested 是客户端请求的目标状态。
	From      string
	Requested string
	// BeforeArchived 是归档前的状态，只在 From 为 archived 时有意义。
	BeforeArchived *string
	// Force 表示用户已经在「还有未完成任务」的提示上确认过。
	Force bool
	// OpenTasks 是该项目下未完成的任务数。
	OpenTasks int32
}

// resolveProjectStatus 算出真正要写入的状态。
//
// 两条规则容易在实现里互相绊住，所以放在一起：
//
//  1. 从归档恢复时目标一律取归档前的状态，客户端报的那个只表示「想恢复」。
//  2. 「还有未完成任务」的确认只拦真正的标记完成。
//  3. 完成不是长期展示分组。确认完成后直接写成 archived；UpdateProject 的 SQL
//     会把完成前的 active / paused 状态记入 status_before_archived，用户恢复时
//     可以继续处理，而不需要先经过一个单独的「已完成」列表。
//
// 顺序不能反：先定下真正要写入的状态，才谈得上判断这是不是一次标记完成。
func resolveProjectStatus(in projectStatusChange) (string, error) {
	if err := validateProjectStatusTransition(in.From, in.Requested); err != nil {
		return "", err
	}

	next := in.Requested
	restoring := in.From == "archived" && in.Requested != "archived"
	if restoring && in.BeforeArchived != nil {
		next = *in.BeforeArchived
		// completed 只可能来自升级前的历史数据。恢复的含义是重新打开，
		// 不能把它恢复成已经不再长期保存的 completed 状态。
		if next == "completed" {
			next = "active"
		}
	}

	if next == "completed" && !restoring && in.OpenTasks > 0 && !in.Force {
		return "", apperr.Newf(apperr.CodeProjectHasOpenTasks,
			"项目下还有 %d 项未完成的任务，确认要标记完成吗？", in.OpenTasks)
	}
	if next == "completed" && !restoring {
		return "archived", nil
	}
	return next, nil
}

// dueInput 描述一次截止语义的设置意图。
type dueInput struct {
	DueDate  *openapi_types.Date
	DueAt    *time.Time
	Timezone *string
}

// resolveDue 校验并归一化截止语义。
//
// due_date 与 due_at 互斥；设置任一者都必须带上时区，
// 否则“某日截止”在用户跨时区时会失去确定含义。
func resolveDue(in dueInput, userTimezone string) (*time.Time, *time.Time, *string, error) {
	if in.DueDate != nil && in.DueAt != nil {
		return nil, nil, nil, apperr.Validation(apperr.Field(
			"due_at", "截止日期与截止时刻不能同时设置。"))
	}
	if in.DueDate == nil && in.DueAt == nil {
		return nil, nil, nil, nil
	}

	tz := userTimezone
	if in.Timezone != nil && strings.TrimSpace(*in.Timezone) != "" {
		tz = *in.Timezone
	}
	if tz == "" {
		tz = timeutil.DefaultTimezone
	}
	// 客户端传来的时区不可信。存进去之后提醒与 Today 收录都按它算，
	// 坏值会静默回退成默认时区——不报错，只是在错误的钟点响。
	if err := timeutil.ValidateLocation(tz); err != nil {
		return nil, nil, nil, apperr.Validation(apperr.Field(
			"due_timezone", "时区名称不合法。"))
	}

	if in.DueDate != nil {
		d := in.DueDate.Time
		return &d, nil, &tz, nil
	}
	at := *in.DueAt
	return nil, &at, &tz, nil
}

// resolveSchedule 校验计划时间。结束必须晚于开始，且两者成对出现。
func resolveSchedule(start, end *time.Time, tz *string, userTimezone string) (*time.Time, *time.Time, *string, error) {
	if start == nil && end == nil {
		return nil, nil, nil, nil
	}
	if start == nil && end != nil {
		return nil, nil, nil, apperr.Validation(apperr.Field(
			"scheduled_start_at", "设置计划结束时间前必须先设置开始时间。"))
	}
	if end != nil && !end.After(*start) {
		return nil, nil, nil, apperr.Validation(apperr.Field(
			"scheduled_end_at", "计划结束时间必须晚于开始时间。"))
	}

	zone := userTimezone
	if tz != nil && strings.TrimSpace(*tz) != "" {
		zone = *tz
	}
	if zone == "" {
		zone = timeutil.DefaultTimezone
	}
	if err := timeutil.ValidateLocation(zone); err != nil {
		return nil, nil, nil, apperr.Validation(apperr.Field(
			"scheduled_timezone", "时区名称不合法。"))
	}
	return start, end, &zone, nil
}

// validateEventTiming 校验 Event 的定时与全天字段组合。
// 两组字段互斥：all_day 时只用日期，否则只用时刻。
func validateEventTiming(allDay bool, startAt, endAt, startDate, endDate *time.Time) error {
	if allDay {
		if startDate == nil {
			return apperr.Validation(apperr.Field("start_date", "全天事件必须提供开始日期。"))
		}
		if startAt != nil || endAt != nil {
			return apperr.Validation(apperr.Field(
				"start_at", "全天事件不能设置具体时刻，请使用 start_date 与 end_date。"))
		}
		if endDate != nil && endDate.Before(*startDate) {
			return apperr.Newf(apperr.CodeEventTimeRangeInvalid, "结束日期不能早于开始日期。")
		}
		return nil
	}

	if startAt == nil {
		return apperr.Validation(apperr.Field("start_at", "定时事件必须提供开始时刻。"))
	}
	if startDate != nil || endDate != nil {
		return apperr.Validation(apperr.Field(
			"start_date", "定时事件不能设置日期字段，请使用 start_at 与 end_at。"))
	}
	if endAt != nil && !endAt.After(*startAt) {
		return apperr.Newf(apperr.CodeEventTimeRangeInvalid, "结束时刻必须晚于开始时刻。")
	}
	return nil
}

// deriveNoteTitle 在用户未提供标题时从正文首行生成。
func deriveNoteTitle(title *string, content string) string {
	if title != nil && strings.TrimSpace(*title) != "" {
		return strings.TrimSpace(*title)
	}
	firstLine := content
	if idx := strings.IndexAny(content, "\n\r"); idx >= 0 {
		firstLine = content[:idx]
	}
	firstLine = strings.TrimSpace(firstLine)
	if firstLine == "" {
		return "无标题笔记"
	}
	// 标题按字符而不是字节截断，避免把中文截成乱码。
	runes := []rune(firstLine)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return firstLine
}

// dateOrNil 把可空日期转换成 API 类型。
func dateOrNil(t *time.Time) *openapi_types.Date {
	if t == nil {
		return nil
	}
	return &openapi_types.Date{Time: *t}
}

// timePtrOfDate 把 API 日期转换成存储类型。
func timePtrOfDate(d *openapi_types.Date) *time.Time {
	if d == nil {
		return nil
	}
	t := d.Time
	return &t
}

// decodeUndoState 解析 Activity 中保存的最小状态快照。
func decodeUndoState(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return nil, apperr.Newf(apperr.CodeValidationFailed, "这条变更没有保存可还原的状态。")
	}
	var state map[string]any
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, apperr.Internal(err)
	}
	return state, nil
}
