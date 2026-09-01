package notifications

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// NotificationAPI 把生成的 strict server 接口映射到通知服务。
type NotificationAPI struct{ svc *Service }

// NewAPI 构造通知 API。
func NewAPI(svc *Service) *NotificationAPI { return &NotificationAPI{svc: svc} }

// ListNotifications 读取产品内通知。
func (h *NotificationAPI) ListNotifications(ctx context.Context, req httpapi.ListNotificationsRequestObject) (httpapi.ListNotificationsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	filter := Filter{Limit: int32(httpx.PageLimit(req.Params.Limit))}
	if req.Params.Cursor != nil {
		cursor, err := httpx.DecodeCursor(req.Params.Cursor)
		if err != nil {
			return nil, err
		}
		if cursor != nil {
			filter.CursorTime, filter.CursorID = &cursor.Time, &cursor.ID
		}
	}
	items, hasMore, err := h.svc.List(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.Notification, 0, len(items))
	for _, item := range items {
		data = append(data, mapNotification(item))
	}
	next := ""
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = httpx.EncodeCursor(last.OccurredAt, last.ID)
	}
	return httpapi.ListNotifications200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// MarkNotificationRead 标记通知已读。
func (h *NotificationAPI) MarkNotificationRead(ctx context.Context, req httpapi.MarkNotificationReadRequestObject) (httpapi.MarkNotificationReadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	item, err := h.svc.MarkRead(ctx, userID, req.NotificationId)
	if err != nil {
		return nil, err
	}
	return httpapi.MarkNotificationRead200JSONResponse{
		Data: mapNotification(item), Meta: httpx.Meta(ctx),
	}, nil
}

func mapNotification(item Item) httpapi.Notification {
	return httpapi.Notification{
		Id: item.ID, Type: httpapi.NotificationType(item.NotificationType),
		Title: item.Title, Body: item.Body,
		SourceType: httpapi.NotificationSourceType(item.SourceType), SourceId: item.SourceID,
		OccurredAt: item.OccurredAt, ReadAt: item.ReadAt, SourceDeleted: item.SourceDeleted,
	}
}
