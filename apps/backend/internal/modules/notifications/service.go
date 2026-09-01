// Package notifications 提供产品内通知的持久化、列表与已读语义。
package notifications

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// ReminderSource 是当前已实现的确定性通知触发来源。
// Push 未接入时也会由 Notification Center 查询把到点提醒持久化。
type ReminderSource interface {
	PendingReminders(ctx context.Context, userID string) ([]views.DueReminder, error)
}

// Service 管理产品内通知。
type Service struct {
	db        *database.DB
	reminders ReminderSource
}

// New 构造通知服务。
func New(db *database.DB, reminders ReminderSource) *Service {
	return &Service{db: db, reminders: reminders}
}

// Filter 是通知分页条件。
type Filter struct {
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// Item 是模块内部稳定模型。
type Item struct {
	ID               string
	NotificationType string
	Title            string
	Body             string
	SourceType       string
	SourceID         string
	OccurredAt       time.Time
	ReadAt           *time.Time
	SourceDeleted    bool
}

// List 先把已经到点的确定性 Reminder 写成最小通知快照，再读取历史。
func (s *Service) List(ctx context.Context, userID string, filter Filter) ([]Item, bool, error) {
	due, err := s.reminders.PendingReminders(ctx, userID)
	if err != nil {
		return nil, false, err
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	var out []Item
	var hasMore bool
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, reminder := range due {
			item := notificationFromReminder(reminder)
			if err := q.UpsertNotification(ctx, dbgen.UpsertNotificationParams{
				ID: item.ID, UserID: userID, NotificationType: item.NotificationType,
				Title: item.Title, Body: item.Body, SourceType: item.SourceType,
				SourceID: item.SourceID, OccurredAt: item.OccurredAt,
			}); err != nil {
				return apperr.Internal(err)
			}
		}

		rows, err := q.ListNotifications(ctx, dbgen.ListNotificationsParams{
			CursorOccurredAt: filter.CursorTime,
			CursorID:         filter.CursorID,
			RowLimit:         limit + 1,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		hasMore = len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}
		out = make([]Item, 0, len(rows))
		for _, row := range rows {
			out = append(out, Item{
				ID: row.ID, NotificationType: row.NotificationType,
				Title: row.Title, Body: row.Body, SourceType: row.SourceType,
				SourceID: row.SourceID, OccurredAt: row.OccurredAt,
				ReadAt: row.ReadAt, SourceDeleted: row.SourceDeleted,
			})
		}
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return out, hasMore, nil
}

// MarkRead 幂等地记录首次已读时间。
func (s *Service) MarkRead(ctx context.Context, userID, notificationID string) (Item, error) {
	var out Item
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.MarkNotificationRead(ctx, notificationID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("通知")
			}
			return apperr.Internal(err)
		}
		out = Item{
			ID: row.ID, NotificationType: row.NotificationType,
			Title: row.Title, Body: row.Body, SourceType: row.SourceType,
			SourceID: row.SourceID, OccurredAt: row.OccurredAt, ReadAt: row.ReadAt,
			SourceDeleted: row.SourceDeleted,
		}
		return nil
	})
	return out, err
}

func notificationFromReminder(reminder views.DueReminder) Item {
	notificationType := "event_reminder"
	body := "日程提醒"
	if reminder.SourceType == "task" {
		notificationType = "task_due"
		body = "任务到期提醒"
	}
	return Item{
		ID: reminder.ID, NotificationType: notificationType,
		Title: reminder.Title, Body: body, SourceType: reminder.SourceType,
		SourceID: reminder.SourceID, OccurredAt: reminder.FireAt,
	}
}
