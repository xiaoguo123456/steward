package assistant

import (
	"context"
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// AssistantAPI 把生成的 strict server 接口映射到 Assistant 服务。
type AssistantAPI struct {
	svc       *Service
	proposals *ProposalService
}

// NewAssistantAPI 构造 AssistantAPI。
func NewAssistantAPI(svc *Service, proposals *ProposalService) *AssistantAPI {
	return &AssistantAPI{svc: svc, proposals: proposals}
}

// ---- Thread ----

// ListThreads 读取对话列表。
func (h *AssistantAPI) ListThreads(ctx context.Context, req httpapi.ListThreadsRequestObject) (httpapi.ListThreadsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)

	includeArchived := req.Params.IncludeArchived != nil && *req.Params.IncludeArchived
	var cursorTime *time.Time
	var cursorID *string
	if cursor != nil {
		cursorTime = &cursor.Time
		cursorID = &cursor.ID
	}

	rows, err := h.svc.ListThreads(ctx, userID, includeArchived, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.AssistantThread, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapThread(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.UpdatedAt, last.ID)
	}
	return httpapi.ListThreads200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateThread 新建对话。
func (h *AssistantAPI) CreateThread(ctx context.Context, req httpapi.CreateThreadRequestObject) (httpapi.CreateThreadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	var title *string
	forceNew := false
	if req.Body != nil {
		title = req.Body.Title
		forceNew = req.Body.ForceNew != nil && *req.Body.ForceNew
	}
	thread, err := h.svc.CreateThread(ctx, userID, title, forceNew)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateThread201JSONResponse{Data: MapThread(thread), Meta: httpx.Meta(ctx)}, nil
}

// GetThread 读取对话摘要。
func (h *AssistantAPI) GetThread(ctx context.Context, req httpapi.GetThreadRequestObject) (httpapi.GetThreadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	thread, err := h.svc.GetThread(ctx, userID, req.ThreadId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetThread200JSONResponse{Data: MapThread(thread), Meta: httpx.Meta(ctx)}, nil
}

// UpdateThread 修改标题或归档状态。
func (h *AssistantAPI) UpdateThread(ctx context.Context, req httpapi.UpdateThreadRequestObject) (httpapi.UpdateThreadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	var status *string
	if req.Body.Status != nil {
		s := string(*req.Body.Status)
		status = &s
	}
	thread, err := h.svc.UpdateThread(ctx, userID, req.ThreadId,
		req.Body.Title, status, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateThread200JSONResponse{Data: MapThread(thread), Meta: httpx.Meta(ctx)}, nil
}

// DeleteThread 删除对话内容。
func (h *AssistantAPI) DeleteThread(ctx context.Context, req httpapi.DeleteThreadRequestObject) (httpapi.DeleteThreadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteThread(ctx, userID, req.ThreadId); err != nil {
		return nil, err
	}
	return httpapi.DeleteThread200JSONResponse(httpx.Mutation(ctx, "",
		httpx.Resource(httpapi.AffectedResourceTypeAssistantThread, req.ThreadId),
	)), nil
}

// ListMessages 读取对话消息。
func (h *AssistantAPI) ListMessages(ctx context.Context, req httpapi.ListMessagesRequestObject) (httpapi.ListMessagesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	cursorSeq := decodeSeqCursor(req.Params.Cursor)

	rows, proposals, err := h.svc.ListMessages(ctx, userID, req.ThreadId, cursorSeq, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.AssistantMessage, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapMessage(row, proposals[row.ID]))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		next = encodeSeqCursor(rows[len(rows)-1].MessageSeq)
	}
	return httpapi.ListMessages200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateTurn 发送一条消息并触发回复。
func (h *AssistantAPI) CreateTurn(ctx context.Context, req httpapi.CreateTurnRequestObject) (httpapi.CreateTurnResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	accepted, err := h.svc.CreateTurn(ctx, userID, req.ThreadId, *req.Body)
	if err != nil {
		return nil, err
	}
	resp := httpapi.CreateTurn202JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.ThreadId = accepted.ThreadID
	resp.Data.MessageId = accepted.MessageID
	resp.Data.TurnId = accepted.TurnID
	resp.Data.OperationId = accepted.OperationID
	return resp, nil
}

// CancelTurn 取消仍在执行的回复。
func (h *AssistantAPI) CancelTurn(ctx context.Context, req httpapi.CancelTurnRequestObject) (httpapi.CancelTurnResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.CancelTurn(ctx, userID, req.TurnId); err != nil {
		return nil, err
	}
	return httpapi.CancelTurn200JSONResponse{Meta: httpx.Meta(ctx)}, nil
}

// ---- Proposal ----

// ListProposals 读取待确认与历史建议。
func (h *AssistantAPI) ListProposals(ctx context.Context, req httpapi.ListProposalsRequestObject) (httpapi.ListProposalsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)

	var statuses []string
	if req.Params.Status != nil {
		for _, s := range *req.Params.Status {
			statuses = append(statuses, string(s))
		}
	}
	var cursorTime *time.Time
	var cursorID *string
	if cursor != nil {
		cursorTime = &cursor.Time
		cursorID = &cursor.ID
	}

	rows, err := h.proposals.List(ctx, userID, statuses, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.ActionProposal, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapProposal(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListProposals200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// GetProposal 读取建议详情。
func (h *AssistantAPI) GetProposal(ctx context.Context, req httpapi.GetProposalRequestObject) (httpapi.GetProposalResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.proposals.Get(ctx, userID, req.ProposalId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetProposal200JSONResponse{Data: MapProposal(row), Meta: httpx.Meta(ctx)}, nil
}

// ConfirmProposal 确认并执行建议。
func (h *AssistantAPI) ConfirmProposal(ctx context.Context, req httpapi.ConfirmProposalRequestObject) (httpapi.ConfirmProposalResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.proposals.Confirm(ctx, userID, req.ProposalId, *req.Body)
	if err != nil {
		return nil, err
	}
	resp := httpapi.ConfirmProposal200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.Proposal = MapProposal(result.Proposal)
	resp.Data.AffectedResources = result.Affected
	if result.ActivityBatchID != "" {
		resp.Data.ActivityBatchId = &result.ActivityBatchID
	}
	return resp, nil
}

// RejectProposal 拒绝建议。
func (h *AssistantAPI) RejectProposal(ctx context.Context, req httpapi.RejectProposalRequestObject) (httpapi.RejectProposalResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.proposals.Reject(ctx, userID, req.ProposalId)
	if err != nil {
		return nil, err
	}
	return httpapi.RejectProposal200JSONResponse{Data: MapProposal(row), Meta: httpx.Meta(ctx)}, nil
}

// ---- 映射 ----

// MapThread 把 Thread 行映射成契约 DTO。
func MapThread(row dbgen.AssistantThread) httpapi.AssistantThread {
	seq := int(row.LastMessageSeq)
	return httpapi.AssistantThread{
		Id:             row.ID,
		Title:          row.Title,
		Status:         httpapi.ThreadStatus(row.Status),
		LastMessageSeq: &seq,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		Version:        int(row.Version),
	}
}

// MapMessage 把消息行映射成契约 DTO。
func MapMessage(row dbgen.AssistantMessage, proposalIDs []string) httpapi.AssistantMessage {
	out := httpapi.AssistantMessage{
		Id:         row.ID,
		ThreadId:   row.ThreadID,
		MessageSeq: int(row.MessageSeq),
		Role:       httpapi.MessageRole(row.Role),
		Content:    row.Content,
		Status:     httpapi.AssistantMessageStatus(row.Status),
		TurnId:     row.TurnID,
		CreatedAt:  row.CreatedAt,
	}
	if len(proposalIDs) > 0 {
		out.ProposalIds = &proposalIDs
	}
	return out
}

// MapProposal 把建议行映射成契约 DTO。
func MapProposal(row dbgen.ActionProposal) httpapi.ActionProposal {
	out := httpapi.ActionProposal{
		Id:           row.ID,
		ThreadId:     row.ThreadID,
		TurnId:       row.TurnID,
		ProposalType: httpapi.ProposalType(row.ProposalType),
		TargetType:   row.TargetType,
		TargetId:     row.TargetID,
		Status:       httpapi.ProposalStatus(row.Status),
		Reason:       row.Reason,
		ExpiresAt:    row.ExpiresAt,
		CreatedAt:    row.CreatedAt,
		Version:      int(row.Version),
	}
	if row.TargetExpectedVersion != nil {
		v := int(*row.TargetExpectedVersion)
		out.TargetExpectedVersion = &v
	}
	if row.ExecutedBatchID != nil {
		out.ExecutedBatchId = row.ExecutedBatchID
	}

	var preview httpapi.ProposalPreview
	if err := json.Unmarshal(row.Preview, &preview); err == nil {
		out.Preview = preview
	}
	if fields := editableFieldsOf(row.Preview); len(fields) > 0 {
		out.EditableFields = &fields
	}
	var sources []string
	if err := json.Unmarshal(row.SourceRefs, &sources); err == nil && len(sources) > 0 {
		out.SourceRefs = &sources
	}
	return out
}
