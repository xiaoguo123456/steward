package lists

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ListAPI 把生成的 strict server 接口映射到应用服务。
// 它只做 DTO 转换与参数取值，不包含业务规则。
type ListAPI struct {
	svc *Service
}

// NewListAPI 构造 ListAPI。
func NewListAPI(svc *Service) *ListAPI { return &ListAPI{svc: svc} }

// ListTaskLists 读取当前用户的全部清单。
func (h *ListAPI) ListTaskLists(ctx context.Context, req httpapi.ListTaskListsRequestObject) (httpapi.ListTaskListsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	includeArchived := req.Params.IncludeArchived != nil && *req.Params.IncludeArchived
	var listKind *string
	if req.Params.ListKind != nil {
		value := string(*req.Params.ListKind)
		listKind = &value
	}

	rows, err := h.svc.List(ctx, userID, includeArchived, listKind)
	if err != nil {
		return nil, err
	}

	out := make([]httpapi.TaskList, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapListRow(row, h.svc.ArchiveRetentionSeconds()))
	}
	return httpapi.ListTaskLists200JSONResponse{Data: out, Meta: httpx.Meta(ctx)}, nil
}

// CreateTaskList 新建清单。
func (h *ListAPI) CreateTaskList(ctx context.Context, req httpapi.CreateTaskListRequestObject) (httpapi.CreateTaskListResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}

	in := CreateInput{Name: req.Body.Name, Icon: req.Body.Icon, Position: req.Body.Position}
	if req.Body.Color != nil {
		color := string(*req.Body.Color)
		in.Color = &color
	}
	if req.Body.ListKind != nil {
		in.ListKind = string(*req.Body.ListKind)
	}

	created, err := h.svc.Create(ctx, userID, in)
	if err != nil {
		return nil, err
	}
	zero := 0
	return httpapi.CreateTaskList201JSONResponse{
		Data: MapTaskList(created, &zero, h.svc.ArchiveRetentionSeconds()),
		Meta: httpx.Meta(ctx),
	}, nil
}

// UpdateTaskList 修改清单。
func (h *ListAPI) UpdateTaskList(ctx context.Context, req httpapi.UpdateTaskListRequestObject) (httpapi.UpdateTaskListResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}

	in := UpdateInput{
		Name:            req.Body.Name,
		Icon:            req.Body.Icon,
		Archived:        req.Body.Archived,
		ExpectedVersion: httpx.ParseIfMatch(req.Params.IfMatch),
	}
	if req.Body.Color != nil {
		color := string(*req.Body.Color)
		in.Color = &color
	}
	if req.Body.Position != nil {
		p := int32(*req.Body.Position)
		in.Position = &p
	}
	if req.Body.Clear != nil {
		for _, field := range *req.Body.Clear {
			switch field {
			case httpapi.UpdateTaskListRequestClearColor:
				in.ClearColor = true
			case httpapi.UpdateTaskListRequestClearIcon:
				in.ClearIcon = true
			}
		}
	}

	updated, err := h.svc.Update(ctx, userID, req.ListId, in)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateTaskList200JSONResponse{
		Data: mapGetRow(updated, h.svc.ArchiveRetentionSeconds()),
		Meta: httpx.Meta(ctx),
	}, nil
}

// DeleteTaskList 删除清单。
func (h *ListAPI) DeleteTaskList(ctx context.Context, req httpapi.DeleteTaskListRequestObject) (httpapi.DeleteTaskListResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}

	var moveTo *string
	if req.Body != nil {
		moveTo = req.Body.MoveTasksToListId
	}
	if err := h.svc.Delete(ctx, userID, req.ListId, moveTo); err != nil {
		return nil, err
	}

	return httpapi.DeleteTaskList200JSONResponse(httpx.Mutation(ctx, "",
		httpx.Resource(httpapi.AffectedResourceTypeTaskList, req.ListId),
		httpx.Resource(httpapi.AffectedResourceTypeTask, ""),
		httpx.Resource(httpapi.AffectedResourceTypeToday, ""),
	)), nil
}

func mapListRow(row dbgen.ListTaskListsRow, retentionSeconds int) httpapi.TaskList {
	count := int(row.TaskCount)
	retention := retentionSeconds
	return httpapi.TaskList{
		Id:                      row.ID,
		Name:                    row.Name,
		Color:                   colorOf(row.Color),
		Icon:                    row.Icon,
		Position:                int(row.Position),
		ListKind:                listKindPtr(row.ListKind),
		IsDefault:               row.IsDefault,
		ArchivedAt:              row.ArchivedAt,
		ArchiveRetentionSeconds: &retention,
		TaskCount:               &count,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
		Version:                 int(row.Version),
	}
}

func mapGetRow(row dbgen.GetTaskListRow, retentionSeconds int) httpapi.TaskList {
	count := int(row.TaskCount)
	retention := retentionSeconds
	return httpapi.TaskList{
		Id:                      row.ID,
		Name:                    row.Name,
		Color:                   colorOf(row.Color),
		Icon:                    row.Icon,
		Position:                int(row.Position),
		ListKind:                listKindPtr(row.ListKind),
		IsDefault:               row.IsDefault,
		ArchivedAt:              row.ArchivedAt,
		ArchiveRetentionSeconds: &retention,
		TaskCount:               &count,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
		Version:                 int(row.Version),
	}
}

// MapTaskList 把清单行映射成契约类型。供 recipes 复用，避免两处映射漂移。
func MapTaskList(row dbgen.TaskList, taskCount *int, retentionSeconds int) httpapi.TaskList {
	retention := retentionSeconds
	return httpapi.TaskList{
		Id:                      row.ID,
		Name:                    row.Name,
		Color:                   colorOf(row.Color),
		Icon:                    row.Icon,
		Position:                int(row.Position),
		ListKind:                listKindPtr(row.ListKind),
		IsDefault:               row.IsDefault,
		ArchivedAt:              row.ArchivedAt,
		ArchiveRetentionSeconds: &retention,
		TaskCount:               taskCount,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
		Version:                 int(row.Version),
	}
}

func colorOf(raw *string) *httpapi.TaskListColor {
	if raw == nil {
		return nil
	}
	c := httpapi.TaskListColor(*raw)
	return &c
}

// listKindPtr 把存储值映射成契约枚举指针。
func listKindPtr(raw string) *httpapi.TaskListKind {
	kind := httpapi.TaskListKind(raw)
	return &kind
}
