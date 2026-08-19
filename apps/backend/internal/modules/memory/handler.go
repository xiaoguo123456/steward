package memory

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// MemoryAPI 把生成的 strict server 接口映射到 Memory 服务。
type MemoryAPI struct {
	svc *Service
}

// NewMemoryAPI 构造 MemoryAPI。
func NewMemoryAPI(svc *Service) *MemoryAPI { return &MemoryAPI{svc: svc} }

// ListMemories 查看系统记住了什么。
func (h *MemoryAPI) ListMemories(ctx context.Context, req httpapi.ListMemoriesRequestObject) (httpapi.ListMemoriesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)

	var memoryType *string
	if req.Params.MemoryType != nil {
		t := string(*req.Params.MemoryType)
		memoryType = &t
	}
	var statuses []string
	if req.Params.Status != nil {
		for _, s := range *req.Params.Status {
			statuses = append(statuses, string(s))
		}
	}

	items, err := h.svc.List(ctx, userID, memoryType, statuses, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(items) > int(limit)
	if hasMore {
		items = items[:limit]
	}
	data := make([]httpapi.MemoryItem, 0, len(items))
	for _, item := range items {
		data = append(data, MapMemory(item))
	}
	next := ""
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = httpx.EncodeCursor(last.Row.UpdatedAt, last.Row.ID)
	}
	return httpapi.ListMemories200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// GetMemory 查看记忆的值与来源。
func (h *MemoryAPI) GetMemory(ctx context.Context, req httpapi.GetMemoryRequestObject) (httpapi.GetMemoryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	item, err := h.svc.Get(ctx, userID, req.MemoryId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetMemory200JSONResponse{Data: MapMemory(item), Meta: httpx.Meta(ctx)}, nil
}

// UpdateMemory 修改已确认的记忆。
func (h *MemoryAPI) UpdateMemory(ctx context.Context, req httpapi.UpdateMemoryRequestObject) (httpapi.UpdateMemoryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	item, err := h.svc.Update(ctx, userID, req.MemoryId, req.Body.CanonicalText,
		httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateMemory200JSONResponse{Data: MapMemory(item), Meta: httpx.Meta(ctx)}, nil
}

// DeleteMemory 删除记忆。
func (h *MemoryAPI) DeleteMemory(ctx context.Context, req httpapi.DeleteMemoryRequestObject) (httpapi.DeleteMemoryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	block := false
	if req.Body != nil && req.Body.BlockRelearning != nil {
		block = *req.Body.BlockRelearning
	}
	result, err := h.svc.Delete(ctx, userID, req.MemoryId, block)
	if err != nil {
		return nil, err
	}
	resp := httpapi.DeleteMemory200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.Recoverable = result.Recoverable
	resp.Data.BlockedRelearning = &result.BlockedRelearning
	return resp, nil
}

// ListRelearnBlocks 查看已禁止重新学习的项目。
func (h *MemoryAPI) ListRelearnBlocks(ctx context.Context, _ httpapi.ListRelearnBlocksRequestObject) (httpapi.ListRelearnBlocksResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := h.svc.ListRelearnBlocks(ctx, userID)
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.RelearnBlock, 0, len(rows))
	for _, row := range rows {
		// 只返回语义键与时间；被阻止的具体内容只有指纹，本来也取不回来。
		data = append(data, httpapi.RelearnBlock{
			Id: row.ID, MemoryKey: row.MemoryKey, BlockedAt: row.BlockedAt,
		})
	}
	return httpapi.ListRelearnBlocks200JSONResponse{Data: data, Meta: httpx.Meta(ctx)}, nil
}

// DeleteRelearnBlock 解除重新学习阻止。
func (h *MemoryAPI) DeleteRelearnBlock(ctx context.Context, req httpapi.DeleteRelearnBlockRequestObject) (httpapi.DeleteRelearnBlockResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteRelearnBlock(ctx, userID, req.BlockId); err != nil {
		return nil, err
	}
	return httpapi.DeleteRelearnBlock200JSONResponse(httpx.Mutation(ctx, "",
		httpx.Resource(httpapi.AffectedResourceTypeMemory, req.BlockId),
	)), nil
}

// MapMemory 把记忆映射成契约 DTO。
//
// 只返回 canonical_text，不返回原始 value JSON：前者是给用户看的规范表述，
// 后者是内部结构，暴露出去只会让客户端依赖不稳定的形状。
func MapMemory(item Item) httpapi.MemoryItem {
	out := httpapi.MemoryItem{
		Id:            item.Row.ID,
		MemoryKey:     item.Row.MemoryKey,
		MemoryType:    httpapi.MemoryType(item.Row.MemoryType),
		CanonicalText: item.Row.CanonicalText,
		Sensitivity:   httpapi.MemorySensitivity(item.Row.Sensitivity),
		Origin:        httpapi.MemoryOrigin(item.Row.Origin),
		Status:        httpapi.MemoryStatus(item.Row.Status),
		ConfirmedAt:   item.Row.ConfirmedAt,
		LastUsedAt:    item.Row.LastUsedAt,
		CreatedAt:     item.Row.CreatedAt,
		UpdatedAt:     &item.Row.UpdatedAt,
		Version:       int(item.Row.Version),
	}
	if len(item.Evidence) > 0 {
		evidence := make([]httpapi.MemoryEvidence, 0, len(item.Evidence))
		for _, e := range item.Evidence {
			evidence = append(evidence, mapEvidence(e))
		}
		out.Evidence = &evidence
	}
	return out
}

func mapEvidence(row dbgen.MemoryEvidence) httpapi.MemoryEvidence {
	return httpapi.MemoryEvidence{
		SourceType:   httpapi.MemoryEvidenceSourceType(row.SourceType),
		SourceId:     row.SourceID,
		EvidenceRole: httpapi.MemoryEvidenceEvidenceRole(row.EvidenceRole),
		CreatedAt:    row.CreatedAt,
	}
}
