package activity

import (
	"context"
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ActivityAPI 提供变更历史、撤销与异步任务状态查询。
type ActivityAPI struct {
	svc     *Service
	undoers []Undoer
}

// NewActivityAPI 构造 ActivityAPI。undoers 由 bootstrap 按模块注入。
func NewActivityAPI(svc *Service, undoers ...Undoer) *ActivityAPI {
	return &ActivityAPI{svc: svc, undoers: undoers}
}

// ListActivityBatches 读取变更历史。
func (h *ActivityAPI) ListActivityBatches(ctx context.Context, req httpapi.ListActivityBatchesRequestObject) (httpapi.ListActivityBatchesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	limit := httpx.PageLimit(req.Params.Limit)
	var cursorTime *time.Time
	var cursorID *string
	if cursor != nil {
		cursorTime = &cursor.Time
		cursorID = &cursor.ID
	}

	batches, err := h.svc.List(ctx, userID, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(batches) > int(limit)
	if hasMore {
		batches = batches[:limit]
	}

	now := time.Now()
	data := make([]httpapi.ActivityBatch, 0, len(batches))
	for _, b := range batches {
		data = append(data, MapBatch(b, now))
	}
	next := ""
	if hasMore && len(batches) > 0 {
		last := batches[len(batches)-1].Row
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListActivityBatches200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// UndoActivityBatch 撤销一个变更批次。
func (h *ActivityAPI) UndoActivityBatch(ctx context.Context, req httpapi.UndoActivityBatchRequestObject) (httpapi.UndoActivityBatchResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	batch, err := h.svc.Undo(ctx, userID, req.BatchId, h.undoers, now)
	if err != nil {
		return nil, err
	}

	// 撤销可能影响多种资源，统一让客户端失效相关集合查询。
	affected := []httpapi.AffectedResource{
		{Type: httpapi.AffectedResourceTypeToday},
		{Type: httpapi.AffectedResourceTypeCalendar},
		{Type: httpapi.AffectedResourceTypeActivity},
	}
	seen := map[string]bool{}
	for _, entry := range batch.Entries {
		if seen[entry.ResourceType] {
			continue
		}
		seen[entry.ResourceType] = true
		id := entry.ResourceID
		affected = append(affected, httpapi.AffectedResource{
			Type: httpapi.AffectedResourceType(entry.ResourceType), Id: &id,
		})
	}

	resp := httpapi.UndoActivityBatch200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.Batch = MapBatch(batch, now)
	resp.Data.AffectedResources = affected
	return resp, nil
}

// GetOperation 读取异步任务状态。
func (h *ActivityAPI) GetOperation(ctx context.Context, req httpapi.GetOperationRequestObject) (httpapi.GetOperationResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}

	var row dbgen.AsyncOperation
	err = h.svc.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		op, err := q.GetOperation(ctx, req.OperationId)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("处理任务")
			}
			return apperr.Internal(err)
		}
		row = op
		return nil
	})
	if err != nil {
		return nil, err
	}

	op := httpapi.AsyncOperation{
		Id:          row.ID,
		Kind:        row.Kind,
		Status:      httpapi.OperationStatus(row.Status),
		CreatedAt:   row.CreatedAt,
		CompletedAt: row.CompletedAt,
	}
	if row.Progress != nil {
		p := int(*row.Progress)
		op.Progress = &p
	}
	if len(row.ResultRef) > 0 {
		var ref map[string]any
		if err := json.Unmarshal(row.ResultRef, &ref); err == nil {
			op.ResultRef = &ref
		}
	}
	if len(row.Error) > 0 {
		var body httpapi.ErrorBody
		if err := json.Unmarshal(row.Error, &body); err == nil {
			op.Error = &body
		}
	}
	return httpapi.GetOperation200JSONResponse{Data: op, Meta: httpx.Meta(ctx)}, nil
}

// MapBatch 把批次映射成契约 DTO。
func MapBatch(b Batch, now time.Time) httpapi.ActivityBatch {
	entries := make([]httpapi.ActivityEntry, 0, len(b.Entries))
	for _, e := range b.Entries {
		title := e.Title
		summary := e.Summary
		entries = append(entries, httpapi.ActivityEntry{
			Id:           e.ID,
			Action:       httpapi.ActivityAction(e.Action),
			ResourceType: e.ResourceType,
			ResourceId:   e.ResourceID,
			Title:        &title,
			Summary:      &summary,
			CreatedAt:    e.CreatedAt,
		})
	}
	return httpapi.ActivityBatch{
		Id:        b.Row.ID,
		Source:    httpapi.ActivityBatchSource(b.Row.Source),
		SourceId:  b.Row.SourceID,
		Entries:   entries,
		Undoable:  Undoable(b.Row, now),
		UndoneAt:  b.Row.UndoneAt,
		CreatedAt: b.Row.CreatedAt,
	}
}
