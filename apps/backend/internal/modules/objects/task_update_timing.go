package objects

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// taskUpdateTiming 是 PATCH 与当前 Task 合并后的完整时间状态。
// 写库时使用这份完整状态，避免 SQL 约束错误被误报为 500。
type taskUpdateTiming struct {
	dueDate           *time.Time
	dueAt             *time.Time
	dueTimezone       *string
	scheduledStartAt  *time.Time
	scheduledEndAt    *time.Time
	scheduledTimezone *string
	reminders         []httpapi.Reminder
	remindersJSON     []byte
}

func resolveTaskUpdateTiming(current dbgen.Task, body httpapi.UpdateTaskRequest,
	clear taskClearFlags, userTimezone string) (taskUpdateTiming, error) {
	var out taskUpdateTiming

	if body.DueDate != nil && body.DueAt != nil {
		return out, apperr.Validation(apperr.Field(
			"due_at", "截止日期与截止时刻不能同时设置。"))
	}
	if clear.DueDate && body.DueDate != nil {
		return out, clearValueConflict("due_date")
	}
	if clear.DueAt && body.DueAt != nil {
		return out, clearValueConflict("due_at")
	}
	if clear.ScheduledStartAt && body.ScheduledStartAt != nil {
		return out, clearValueConflict("scheduled_start_at")
	}
	if clear.ScheduledStartAt && body.ScheduledEndAt != nil {
		return out, apperr.Validation(apperr.Field(
			"scheduled_end_at", "清空计划开始时间时不能同时设置结束时间。"))
	}
	if clear.ScheduledEndAt && body.ScheduledEndAt != nil {
		return out, clearValueConflict("scheduled_end_at")
	}
	if clear.Reminders && body.Reminders != nil {
		return out, clearValueConflict("reminders")
	}

	out.dueDate = current.DueDate
	out.dueAt = current.DueAt
	out.dueTimezone = current.DueTimezone
	if clear.DueDate {
		out.dueDate = nil
	}
	if clear.DueAt {
		out.dueAt = nil
	}
	if body.DueDate != nil {
		date := body.DueDate.Time
		out.dueDate = &date
		out.dueAt = nil
	}
	if body.DueAt != nil {
		out.dueAt = body.DueAt
		out.dueDate = nil
	}
	if body.DueTimezone != nil {
		zone := strings.TrimSpace(*body.DueTimezone)
		out.dueTimezone = &zone
	} else if body.DueDate != nil || body.DueAt != nil {
		// 用户重新选择截止值时，未显式传时区就采用本次操作的用户时区，
		// 不沿用旧截止可能来自另一地点的时区。
		zone := userTimezone
		out.dueTimezone = &zone
	}
	if out.dueDate == nil && out.dueAt == nil {
		if body.DueTimezone != nil {
			return out, apperr.Validation(apperr.Field(
				"due_timezone", "没有截止信息时不能设置截止时区。"))
		}
		out.dueTimezone = nil
	} else {
		if out.dueTimezone == nil || *out.dueTimezone == "" {
			zone := userTimezone
			if zone == "" {
				zone = timeutil.DefaultTimezone
			}
			out.dueTimezone = &zone
		}
		if err := timeutil.ValidateLocation(*out.dueTimezone); err != nil {
			return out, apperr.Validation(apperr.Field("due_timezone", "时区名称不合法。"))
		}
	}

	out.scheduledStartAt = current.ScheduledStartAt
	out.scheduledEndAt = current.ScheduledEndAt
	out.scheduledTimezone = current.ScheduledTimezone
	if clear.ScheduledStartAt {
		out.scheduledStartAt = nil
		out.scheduledEndAt = nil
		out.scheduledTimezone = nil
	} else {
		if clear.ScheduledEndAt {
			out.scheduledEndAt = nil
		}
		if body.ScheduledStartAt != nil {
			out.scheduledStartAt = body.ScheduledStartAt
		}
		if body.ScheduledEndAt != nil {
			out.scheduledEndAt = body.ScheduledEndAt
		}
		if body.ScheduledTimezone != nil {
			zone := strings.TrimSpace(*body.ScheduledTimezone)
			out.scheduledTimezone = &zone
		} else if body.ScheduledStartAt != nil {
			zone := userTimezone
			out.scheduledTimezone = &zone
		}
	}
	if out.scheduledStartAt == nil {
		if out.scheduledEndAt != nil {
			return out, apperr.Validation(apperr.Field(
				"scheduled_start_at", "设置计划结束时间前必须先设置开始时间。"))
		}
		if body.ScheduledTimezone != nil {
			return out, apperr.Validation(apperr.Field(
				"scheduled_timezone", "没有计划时间时不能设置计划时区。"))
		}
		out.scheduledTimezone = nil
	} else {
		if out.scheduledEndAt != nil && !out.scheduledEndAt.After(*out.scheduledStartAt) {
			return out, apperr.Validation(apperr.Field(
				"scheduled_end_at", "计划结束时间必须晚于开始时间。"))
		}
		if out.scheduledTimezone == nil || *out.scheduledTimezone == "" {
			zone := userTimezone
			if zone == "" {
				zone = timeutil.DefaultTimezone
			}
			out.scheduledTimezone = &zone
		}
		if err := timeutil.ValidateLocation(*out.scheduledTimezone); err != nil {
			return out, apperr.Validation(apperr.Field(
				"scheduled_timezone", "时区名称不合法。"))
		}
	}

	if !clear.Reminders && len(current.Reminders) > 0 {
		if err := json.Unmarshal(current.Reminders, &out.reminders); err != nil {
			return out, apperr.Internal(err)
		}
	}
	if body.Reminders != nil {
		reminders, err := buildReminders(body.Reminders, out.dueAt != nil)
		if err != nil {
			return out, err
		}
		out.reminders = reminders
	}
	if len(out.reminders) > 0 && out.dueDate == nil && out.dueAt == nil {
		return out, apperr.Validation(apperr.Field(
			"reminders", "没有截止信息时不能设置提醒。"))
	}
	if out.dueAt == nil {
		for _, reminder := range out.reminders {
			if reminder.Kind == httpapi.ReminderKindRelative {
				return out, apperr.Validation(apperr.Field(
					"reminders", "日期型截止只能使用明确的当地提醒时间。"))
			}
		}
	}
	remindersJSON, err := marshalJSON(out.reminders)
	if err != nil {
		return out, err
	}
	out.remindersJSON = remindersJSON
	return out, nil
}

func clearValueConflict(field string) error {
	return apperr.Validation(apperr.Field(field, "同一字段不能同时清空并设置新值。"))
}
