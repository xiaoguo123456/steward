package memorymoments

import (
	"context"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// MemoryMomentAPI 把生成的 strict server 接口映射到时光服务。
type MemoryMomentAPI struct{ svc *Service }

// NewAPI 构造时光 API。
func NewAPI(svc *Service) *MemoryMomentAPI { return &MemoryMomentAPI{svc: svc} }

// ListMemoryMoments 查询时光。
func (h *MemoryMomentAPI) ListMemoryMoments(ctx context.Context, req httpapi.ListMemoryMomentsRequestObject) (httpapi.ListMemoryMomentsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	filter := Filter{Limit: httpx.PageLimit(req.Params.Limit) + 1}
	if req.Params.From != nil {
		filter.FromDate = &req.Params.From.Time
	}
	if req.Params.To != nil {
		filter.ToDate = &req.Params.To.Time
	}
	if req.Params.Cursor != nil {
		cursor, err := httpx.DecodeCursor(req.Params.Cursor)
		if err != nil {
			return nil, err
		}
		if cursor != nil {
			filter.CursorOccurredOn, filter.CursorID = &cursor.Time, &cursor.ID
		}
	}
	rows, err := h.svc.List(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.MemoryMoment, 0, len(rows))
	for _, row := range rows {
		data = append(data, mapMoment(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1].Row
		next = httpx.EncodeCursor(last.OccurredOn, last.ID)
	}
	return httpapi.ListMemoryMoments200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateMemoryMoment 发布时光。
func (h *MemoryMomentAPI) CreateMemoryMoment(ctx context.Context, req httpapi.CreateMemoryMomentRequestObject) (httpapi.CreateMemoryMomentResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.Create(ctx, userID, string(req.Params.IdempotencyKey), *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateMemoryMoment201JSONResponse{
		Data: mapMoment(created), Meta: httpx.Meta(ctx),
	}, nil
}

// GetMemoryMoment 读取时光详情。
func (h *MemoryMomentAPI) GetMemoryMoment(ctx context.Context, req httpapi.GetMemoryMomentRequestObject) (httpapi.GetMemoryMomentResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	moment, err := h.svc.Get(ctx, userID, req.MomentId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetMemoryMoment200JSONResponse{
		Data: mapMoment(moment), Meta: httpx.Meta(ctx),
	}, nil
}

// DeleteMemoryMoment 删除整段时光。
func (h *MemoryMomentAPI) DeleteMemoryMoment(ctx context.Context, req httpapi.DeleteMemoryMomentRequestObject) (httpapi.DeleteMemoryMomentResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.Delete(ctx, userID, req.MomentId, string(req.Params.IdempotencyKey))
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteMemoryMoment200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeMemoryMoment, req.MomentId),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

func mapMoment(moment Moment) httpapi.MemoryMoment {
	photos := make([]httpapi.MemoryMomentPhoto, 0, len(moment.Photos))
	for _, photo := range moment.Photos {
		photos = append(photos, httpapi.MemoryMomentPhoto{
			MediaId: photo.MediaID, ReadUrl: photo.ReadURL,
			Description: photo.Description, Position: int(photo.Position),
		})
	}
	return httpapi.MemoryMoment{
		Id:         moment.Row.ID,
		OccurredOn: openapi_types.Date{Time: moment.Row.OccurredOn},
		Title:      moment.Row.Title, Story: moment.Row.Story, Photos: photos,
		CreatedBy: httpapi.CreatedBy(moment.Row.CreatedBy), CreatedAt: moment.Row.CreatedAt,
	}
}
