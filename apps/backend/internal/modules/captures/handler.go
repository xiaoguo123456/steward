package captures

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// CaptureAPI 把生成的 strict server 接口映射到 Capture 服务。
type CaptureAPI struct {
	svc *Service
}

// NewCaptureAPI 构造 CaptureAPI。
func NewCaptureAPI(svc *Service) *CaptureAPI { return &CaptureAPI{svc: svc} }

// CreateCapture 提交一次输入，返回 202 与 operation_id。
func (h *CaptureAPI) CreateCapture(ctx context.Context, req httpapi.CreateCaptureRequestObject) (httpapi.CreateCaptureResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.svc.Create(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	resp := httpapi.CreateCapture202JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.OperationId = result.OperationID
	resp.Data.ResourceId = &result.CaptureID
	return resp, nil
}

// GetCapture 读取 Capture 状态与候选。
func (h *CaptureAPI) GetCapture(ctx context.Context, req httpapi.GetCaptureRequestObject) (httpapi.GetCaptureResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	detail, err := h.svc.Get(ctx, userID, req.CaptureId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetCapture200JSONResponse{Data: MapCapture(detail), Meta: httpx.Meta(ctx)}, nil
}

// DiscardCapture 放弃本次输入。
func (h *CaptureAPI) DiscardCapture(ctx context.Context, req httpapi.DiscardCaptureRequestObject) (httpapi.DiscardCaptureResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.Discard(ctx, userID, req.CaptureId); err != nil {
		return nil, err
	}
	return httpapi.DiscardCapture200JSONResponse(httpx.Mutation(ctx, "",
		httpx.Resource(httpapi.AffectedResourceTypeCapture, req.CaptureId),
	)), nil
}

// ConfirmCapture 确认并保存候选项。
func (h *CaptureAPI) ConfirmCapture(ctx context.Context, req httpapi.ConfirmCaptureRequestObject) (httpapi.ConfirmCaptureResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.svc.Confirm(ctx, userID, req.CaptureId, *req.Body)
	if err != nil {
		return nil, err
	}
	resp := httpapi.ConfirmCapture200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.Capture = MapCapture(result.Detail)
	resp.Data.AffectedResources = result.Affected
	return resp, nil
}

// ListCaptureQuestions 读取全局待答问题。
func (h *CaptureAPI) ListCaptureQuestions(ctx context.Context, req httpapi.ListCaptureQuestionsRequestObject) (httpapi.ListCaptureQuestionsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	status := "open"
	if req.Params.Status != nil {
		status = string(*req.Params.Status)
	}
	limit := httpx.PageLimit(req.Params.Limit)

	var cursorTime *time.Time
	var cursorID *string
	if cursor != nil {
		cursorTime = &cursor.Time
		cursorID = &cursor.ID
	}

	rows, err := h.svc.ListQuestions(ctx, userID, status, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, err
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.CaptureQuestion, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapQuestion(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListCaptureQuestions200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// AnswerCaptureQuestion 回答一个待答问题。
func (h *CaptureAPI) AnswerCaptureQuestion(ctx context.Context, req httpapi.AnswerCaptureQuestionRequestObject) (httpapi.AnswerCaptureQuestionResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.svc.AnswerQuestion(ctx, userID, req.QuestionId, req.Body.Answer)
	if err != nil {
		return nil, err
	}
	resp := httpapi.AnswerCaptureQuestion202JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.OperationId = result.OperationID
	resp.Data.ResourceId = &result.CaptureID
	return resp, nil
}
