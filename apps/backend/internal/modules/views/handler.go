package views

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ViewAPI 把生成的 strict server 接口映射到聚合视图服务。
type ViewAPI struct {
	svc *Service
}

// NewViewAPI 构造 ViewAPI。
func NewViewAPI(svc *Service) *ViewAPI { return &ViewAPI{svc: svc} }

// GetToday 读取今天的任务与日程。
func (h *ViewAPI) GetToday(ctx context.Context, _ httpapi.GetTodayRequestObject) (httpapi.GetTodayResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	today, err := h.svc.GetToday(ctx, userID)
	if err != nil {
		return nil, err
	}
	return httpapi.GetToday200JSONResponse{Data: MapToday(today), Meta: httpx.Meta(ctx)}, nil
}

// GetCalendar 按日期范围读取日历。
func (h *ViewAPI) GetCalendar(ctx context.Context, req httpapi.GetCalendarRequestObject) (httpapi.GetCalendarResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cal, err := h.svc.GetCalendar(ctx, userID,
		req.Params.From.Time, req.Params.To.Time, req.Params.ProjectId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetCalendar200JSONResponse{Data: MapCalendar(cal), Meta: httpx.Meta(ctx)}, nil
}

// GetWeeklyReview 读取某一周的复盘。
func (h *ViewAPI) GetWeeklyReview(ctx context.Context, req httpapi.GetWeeklyReviewRequestObject) (httpapi.GetWeeklyReviewResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	var weekOf *time.Time
	if req.Params.WeekOf != nil {
		t := req.Params.WeekOf.Time
		weekOf = &t
	}
	review, err := h.svc.GetWeeklyReview(ctx, userID, weekOf)
	if err != nil {
		return nil, err
	}
	return httpapi.GetWeeklyReview200JSONResponse{Data: review, Meta: httpx.Meta(ctx)}, nil
}

// Search 跨实体关键词检索。
func (h *ViewAPI) Search(ctx context.Context, req httpapi.SearchRequestObject) (httpapi.SearchResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	var types []string
	if req.Params.Types != nil {
		for _, t := range *req.Params.Types {
			types = append(types, string(t))
		}
	}
	limit := httpx.PageLimit(req.Params.Limit)
	hits, err := h.svc.Search(ctx, userID, req.Params.Q, types, limit)
	if err != nil {
		return nil, err
	}
	if hits == nil {
		hits = []httpapi.SearchHit{}
	}
	// 搜索目前一次返回全部命中，不提供游标翻页。
	return httpapi.Search200JSONResponse{
		Data: hits, Page: httpx.PageOf(false, ""), Meta: httpx.Meta(ctx),
	}, nil
}

func openapiDate(t time.Time) openapi_types.Date {
	return openapi_types.Date{Time: t}
}
