package notifications

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
)

func TestNotificationFromReminderKeepsStableTriggerIdentity(t *testing.T) {
	fireAt := time.Date(2026, 9, 1, 9, 30, 0, 0, time.UTC)
	item := notificationFromReminder(views.DueReminder{
		ID: "tsk_1|rmd_1|2026-09-01", SourceType: "task", SourceID: "tsk_1",
		Title: "提交报告", FireAt: fireAt,
	})

	if item.ID != "tsk_1|rmd_1|2026-09-01" || item.NotificationType != "task_due" {
		t.Fatalf("任务提醒映射错误：%+v", item)
	}
	if item.SourceID != "tsk_1" || item.Body != "任务到期提醒" || !item.OccurredAt.Equal(fireAt) {
		t.Fatalf("任务提醒快照丢失字段：%+v", item)
	}
}

func TestNotificationFromEventReminder(t *testing.T) {
	item := notificationFromReminder(views.DueReminder{
		ID: "evt_1|rmd_2|2026-09-02", SourceType: "event", SourceID: "evt_1",
		Title: "牙医预约",
	})
	if item.NotificationType != "event_reminder" || item.Body != "日程提醒" {
		t.Fatalf("日程提醒映射错误：%+v", item)
	}
}
