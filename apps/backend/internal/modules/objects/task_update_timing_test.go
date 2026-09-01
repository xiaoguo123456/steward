package objects

import (
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

func TestResolveTaskUpdateTimingRejectsClearingDueWithExistingReminder(t *testing.T) {
	dueDate := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	zone := "Asia/Shanghai"
	current := dbgen.Task{
		DueDate: &dueDate, DueTimezone: &zone,
		Reminders: []byte(`[{"id":"rmd_1","kind":"absolute_local","local_time":"09:00","days_before":0}]`),
	}

	_, err := resolveTaskUpdateTiming(current, httpapi.UpdateTaskRequest{},
		taskClearFlags{DueDate: true}, zone)
	assertTaskValidationField(t, err, "reminders")
}

func TestResolveTaskUpdateTimingRejectsRelativeReminderAfterSwitchToDate(t *testing.T) {
	dueAt := time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC)
	zone := "Asia/Shanghai"
	newDate := openapi_types.Date{Time: time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)}
	current := dbgen.Task{
		DueAt: &dueAt, DueTimezone: &zone,
		Reminders: []byte(`[{"id":"rmd_1","kind":"relative","offset_minutes":60}]`),
	}

	_, err := resolveTaskUpdateTiming(current, httpapi.UpdateTaskRequest{DueDate: &newDate},
		taskClearFlags{}, zone)
	assertTaskValidationField(t, err, "reminders")
}

func TestResolveTaskUpdateTimingValidatesMergedSchedule(t *testing.T) {
	start := time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	zone := "Asia/Shanghai"
	newStart := end.Add(time.Hour)
	current := dbgen.Task{
		ScheduledStartAt: &start, ScheduledEndAt: &end, ScheduledTimezone: &zone,
	}

	_, err := resolveTaskUpdateTiming(current,
		httpapi.UpdateTaskRequest{ScheduledStartAt: &newStart}, taskClearFlags{}, zone)
	assertTaskValidationField(t, err, "scheduled_end_at")

	_, err = resolveTaskUpdateTiming(current,
		httpapi.UpdateTaskRequest{ScheduledEndAt: &end},
		taskClearFlags{ScheduledStartAt: true}, zone)
	assertTaskValidationField(t, err, "scheduled_end_at")
}

func TestResolveTaskUpdateTimingClearsCompleteTemporalState(t *testing.T) {
	dueDate := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	zone := "Asia/Shanghai"
	current := dbgen.Task{
		DueDate: &dueDate, DueTimezone: &zone,
		ScheduledStartAt: &start, ScheduledEndAt: &end, ScheduledTimezone: &zone,
		Reminders: []byte(`[{"id":"rmd_1","kind":"absolute_local","local_time":"09:00","days_before":0}]`),
	}

	got, err := resolveTaskUpdateTiming(current, httpapi.UpdateTaskRequest{},
		taskClearFlags{DueDate: true, Reminders: true, ScheduledStartAt: true}, zone)
	if err != nil {
		t.Fatalf("清空相互依赖的时间字段应成功：%v", err)
	}
	if got.dueDate != nil || got.dueAt != nil || got.dueTimezone != nil {
		t.Fatalf("截止状态未完整清空：%+v", got)
	}
	if got.scheduledStartAt != nil || got.scheduledEndAt != nil || got.scheduledTimezone != nil {
		t.Fatalf("计划状态未完整清空：%+v", got)
	}
	if len(got.reminders) != 0 || string(got.remindersJSON) != "[]" {
		t.Fatalf("提醒未完整清空：%s", got.remindersJSON)
	}
}

func assertTaskValidationField(t *testing.T, err error, field string) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || len(appErr.Fields) == 0 || appErr.Fields[0].Field != field {
		t.Fatalf("期望 %s 字段校验错误，实际：%v", field, err)
	}
}
