package trackers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// TrackerAPI 把生成的 strict server 接口映射到应用服务。
type TrackerAPI struct {
	svc *Service
}

// NewTrackerAPI 构造 TrackerAPI。
func NewTrackerAPI(svc *Service) *TrackerAPI { return &TrackerAPI{svc: svc} }

// ListTrackers 读取全部 Tracker。
func (h *TrackerAPI) ListTrackers(ctx context.Context, req httpapi.ListTrackersRequestObject) (httpapi.ListTrackersResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	var status *string
	if req.Params.Status != nil {
		v := string(*req.Params.Status)
		status = &v
	}
	rows, err := h.svc.ListTrackers(ctx, userID, status)
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.Tracker, 0, len(rows))
	for _, row := range rows {
		data = append(data, mapTracker(row))
	}
	return httpapi.ListTrackers200JSONResponse{Data: data, Meta: httpx.Meta(ctx)}, nil
}

// CreateTracker 新建 Tracker。
func (h *TrackerAPI) CreateTracker(ctx context.Context, req httpapi.CreateTrackerRequestObject) (httpapi.CreateTrackerResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.CreateTracker(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateTracker201JSONResponse{
		Data: mapTracker(TrackerWithStats{Row: created}), Meta: httpx.Meta(ctx),
	}, nil
}

// GetTracker 读取 Tracker 详情。
func (h *TrackerAPI) GetTracker(ctx context.Context, req httpapi.GetTrackerRequestObject) (httpapi.GetTrackerResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetTracker(ctx, userID, req.TrackerId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetTracker200JSONResponse{Data: mapTracker(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateTracker 修改 Tracker。
func (h *TrackerAPI) UpdateTracker(ctx context.Context, req httpapi.UpdateTrackerRequestObject) (httpapi.UpdateTrackerResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.UpdateTracker(ctx, userID, req.TrackerId, *req.Body, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateTracker200JSONResponse{Data: mapTracker(row), Meta: httpx.Meta(ctx)}, nil
}

// DeleteTracker 删除 Tracker。
func (h *TrackerAPI) DeleteTracker(ctx context.Context, req httpapi.DeleteTrackerRequestObject) (httpapi.DeleteTrackerResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteTracker(ctx, userID, req.TrackerId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteTracker200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeTracker, req.TrackerId),
		httpx.Resource(httpapi.AffectedResourceTypeRecord, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// ListRecords 查询 Record。
func (h *TrackerAPI) ListRecords(ctx context.Context, req httpapi.ListRecordsRequestObject) (httpapi.ListRecordsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	limit := httpx.PageLimit(req.Params.Limit)
	filter := RecordFilter{TrackerID: req.Params.TrackerId, Limit: limit + 1}
	if req.Params.From != nil {
		t := req.Params.From.Time
		filter.From = &t
	}
	if req.Params.To != nil {
		// to 是当地日期，按当天结束时刻闭区间处理。
		t := req.Params.To.Time.AddDate(0, 0, 1).Add(-time.Nanosecond)
		filter.To = &t
	}
	if cursor != nil {
		filter.CursorTime = &cursor.Time
		filter.CursorID = &cursor.ID
	}

	rows, err := h.svc.ListRecords(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Record, 0, len(rows))
	for _, row := range rows {
		data = append(data, mapListRecord(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.Timestamp, last.ID)
	}
	return httpapi.ListRecords200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateRecord 新建 Record。
func (h *TrackerAPI) CreateRecord(ctx context.Context, req httpapi.CreateRecordRequestObject) (httpapi.CreateRecordResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.CreateRecord(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateRecord201JSONResponse{Data: mapGetRecord(row), Meta: httpx.Meta(ctx)}, nil
}

// GetRecord 读取 Record 详情。
func (h *TrackerAPI) GetRecord(ctx context.Context, req httpapi.GetRecordRequestObject) (httpapi.GetRecordResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetRecord(ctx, userID, req.RecordId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetRecord200JSONResponse{Data: mapGetRecord(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateRecord 修改 Record。
func (h *TrackerAPI) UpdateRecord(ctx context.Context, req httpapi.UpdateRecordRequestObject) (httpapi.UpdateRecordResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.UpdateRecord(ctx, userID, req.RecordId, *req.Body, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateRecord200JSONResponse{Data: mapGetRecord(row), Meta: httpx.Meta(ctx)}, nil
}

// DeleteRecord 删除 Record。
func (h *TrackerAPI) DeleteRecord(ctx context.Context, req httpapi.DeleteRecordRequestObject) (httpapi.DeleteRecordResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteRecord(ctx, userID, req.RecordId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteRecord200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeRecord, req.RecordId),
		httpx.Resource(httpapi.AffectedResourceTypeTracker, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

func mapTracker(t TrackerWithStats) httpapi.Tracker {
	row := t.Row
	count := int(t.Stats.RecordCount)
	out := httpapi.Tracker{
		Id:             row.ID,
		Name:           row.Name,
		Description:    row.Description,
		Fields:         decodeFieldsOrEmpty(row.Fields),
		Status:         httpapi.TrackerStatus(row.Status),
		RecordCount:    &count,
		LastRecordAt:   t.Stats.LastRecordAt,
		Icon:           row.Icon,
		CreatedBy:      httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs: decodeProvenance(row.ProvenanceRefs),
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		DeletedAt:      row.DeletedAt,
		Version:        int(row.Version),
	}
	if row.Color != nil {
		c := httpapi.TrackerColor(*row.Color)
		out.Color = &c
	}
	return out
}

func mapGetRecord(row dbgen.GetRecordRow) httpapi.Record {
	name := row.TrackerName
	return httpapi.Record{
		Id:             row.ID,
		Type:           httpapi.RecordTypeRecord,
		Title:          row.Title,
		TrackerId:      row.TrackerID,
		TrackerName:    &name,
		Timestamp:      row.Timestamp,
		Values:         decodeValues(row.Values),
		Note:           row.Note,
		ProjectId:      row.ProjectID,
		CreatedBy:      httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs: decodeProvenance(row.ProvenanceRefs),
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		DeletedAt:      row.DeletedAt,
		Version:        int(row.Version),
	}
}

func mapListRecord(row dbgen.ListRecordsRow) httpapi.Record {
	return mapGetRecord(dbgen.GetRecordRow{
		ID: row.ID, UserID: row.UserID, Title: row.Title, TrackerID: row.TrackerID,
		Timestamp: row.Timestamp, Values: row.Values, Note: row.Note,
		ProjectID: row.ProjectID, CreatedBy: row.CreatedBy,
		ProvenanceRefs: row.ProvenanceRefs, CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt, DeletedAt: row.DeletedAt, Version: row.Version,
		TrackerName: row.TrackerName,
	})
}

func decodeFieldsOrEmpty(raw []byte) []httpapi.TrackerField {
	fields, err := decodeFields(raw)
	if err != nil {
		return []httpapi.TrackerField{}
	}
	return fields
}

func decodeValues(raw []byte) []httpapi.RecordValue {
	var values []httpapi.RecordValue
	if err := json.Unmarshal(raw, &values); err != nil {
		return []httpapi.RecordValue{}
	}
	return values
}

func decodeProvenance(raw []byte) *[]httpapi.ProvenanceRef {
	if len(raw) == 0 {
		return nil
	}
	var refs []httpapi.ProvenanceRef
	if err := json.Unmarshal(raw, &refs); err != nil || len(refs) == 0 {
		return nil
	}
	return &refs
}
