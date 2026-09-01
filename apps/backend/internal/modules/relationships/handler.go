package relationships

import (
	"context"
	"encoding/json"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// EventMapper 由 bootstrap 注入 objects 的唯一 Event DTO 映射。
type EventMapper func(dbgen.Event) httpapi.Event

// RelationshipAPI 把生成的 strict server 接口映射到亲友服务。
type RelationshipAPI struct {
	svc      *Service
	mapEvent EventMapper
}

// NewAPI 构造亲友 API。
func NewAPI(svc *Service, mapEvent EventMapper) *RelationshipAPI {
	return &RelationshipAPI{svc: svc, mapEvent: mapEvent}
}

// ListPeople 查询亲友。
func (h *RelationshipAPI) ListPeople(ctx context.Context, req httpapi.ListPeopleRequestObject) (httpapi.ListPeopleResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	filter := PersonFilter{Query: req.Params.Q, Limit: limit + 1}
	if req.Params.RelationshipGroup != nil {
		value := string(*req.Params.RelationshipGroup)
		filter.Group = &value
	}
	if cursor != nil {
		filter.CursorTime, filter.CursorID = &cursor.Time, &cursor.ID
	}
	rows, err := h.svc.List(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Person, 0, len(rows))
	for _, row := range rows {
		data = append(data, mapPerson(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListPeople200JSONResponse{Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx)}, nil
}

// CreatePerson 手动添加亲友。
func (h *RelationshipAPI) CreatePerson(ctx context.Context, req httpapi.CreatePersonRequestObject) (httpapi.CreatePersonResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Create(ctx, userID, string(req.Params.IdempotencyKey), *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreatePerson201JSONResponse{Data: mapPerson(row), Meta: httpx.Meta(ctx)}, nil
}

// GetPerson 读取人物详情。
func (h *RelationshipAPI) GetPerson(ctx context.Context, req httpapi.GetPersonRequestObject) (httpapi.GetPersonResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Get(ctx, userID, req.PersonId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetPerson200JSONResponse{Data: mapPerson(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdatePerson 修改人物资料。
func (h *RelationshipAPI) UpdatePerson(ctx context.Context, req httpapi.UpdatePersonRequestObject) (httpapi.UpdatePersonResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Update(ctx, userID, req.PersonId, *req.Body, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.UpdatePerson200JSONResponse{Data: mapPerson(row), Meta: httpx.Meta(ctx)}, nil
}

// DeletePerson 删除人物但保留已经创建的 Event。
func (h *RelationshipAPI) DeletePerson(ctx context.Context, req httpapi.DeletePersonRequestObject) (httpapi.DeletePersonResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.Delete(ctx, userID, req.PersonId, string(req.Params.IdempotencyKey))
	if err != nil {
		return nil, err
	}
	return httpapi.DeletePerson200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypePerson, req.PersonId),
		httpx.Resource(httpapi.AffectedResourceTypePersonInteraction, ""),
		httpx.Resource(httpapi.AffectedResourceTypeEvent, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""))), nil
}

// ListPersonInteractions 为已发布旧版 App 保留历史互动查询兼容。
func (h *RelationshipAPI) ListPersonInteractions(ctx context.Context, req httpapi.ListPersonInteractionsRequestObject) (httpapi.ListPersonInteractionsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	filter := InteractionFilter{Limit: limit + 1}
	if cursor != nil {
		filter.CursorTime, filter.CursorID = &cursor.Time, &cursor.ID
	}
	rows, err := h.svc.ListInteractions(ctx, userID, req.PersonId, filter)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.PersonInteraction, 0, len(rows))
	for _, row := range rows {
		data = append(data, mapInteraction(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.OccurredAt, last.ID)
	}
	return httpapi.ListPersonInteractions200JSONResponse{Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx)}, nil
}

// CreatePersonInteraction 为已发布旧版 App 保留互动写入兼容。
func (h *RelationshipAPI) CreatePersonInteraction(ctx context.Context, req httpapi.CreatePersonInteractionRequestObject) (httpapi.CreatePersonInteractionResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.CreateInteraction(ctx, userID, req.PersonId, string(req.Params.IdempotencyKey), *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreatePersonInteraction201JSONResponse{Data: mapInteraction(row), Meta: httpx.Meta(ctx)}, nil
}

// ListPersonEvents 查询人物关联事件。
func (h *RelationshipAPI) ListPersonEvents(ctx context.Context, req httpapi.ListPersonEventsRequestObject) (httpapi.ListPersonEventsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	filter := PersonFilter{Limit: limit + 1}
	if cursor != nil {
		filter.CursorTime, filter.CursorID = &cursor.Time, &cursor.ID
	}
	rows, err := h.svc.ListEvents(ctx, userID, req.PersonId, filter)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Event, 0, len(rows))
	for _, row := range rows {
		data = append(data, h.mapEvent(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListPersonEvents200JSONResponse{Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx)}, nil
}

// CreatePersonEvent 创建并关联正式 Event。
func (h *RelationshipAPI) CreatePersonEvent(ctx context.Context, req httpapi.CreatePersonEventRequestObject) (httpapi.CreatePersonEventResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.CreateEvent(ctx, userID, req.PersonId, string(req.Params.IdempotencyKey), *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreatePersonEvent201JSONResponse{Data: h.mapEvent(row), Meta: httpx.Meta(ctx)}, nil
}

func mapPerson(row dbgen.Person) httpapi.Person {
	return httpapi.Person{
		Id: row.ID, Name: row.Name, RelationshipGroup: httpapi.RelationshipGroup(row.RelationshipGroup),
		RelationshipLabel: row.RelationshipLabel, Note: row.Note, CreatedBy: httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs: decodeProvenance(row.ProvenanceRefs), CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt, Version: int(row.Version),
	}
}

func mapInteraction(row dbgen.PersonInteraction) httpapi.PersonInteraction {
	return httpapi.PersonInteraction{
		Id: row.ID, PersonId: row.PersonID, InteractionType: httpapi.PersonInteractionType(row.InteractionType),
		OccurredAt: row.OccurredAt, Summary: row.Summary, Note: row.Note,
		CreatedBy: httpapi.CreatedBy(row.CreatedBy), ProvenanceRefs: decodeProvenance(row.ProvenanceRefs),
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Version: int(row.Version),
	}
}

func decodeProvenance(raw []byte) *[]httpapi.ProvenanceRef {
	items := make([]httpapi.ProvenanceRef, 0)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &items)
	}
	return &items
}
