package objects

import (
	"context"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// ObjectAPI 把生成的 strict server 接口映射到应用服务。
type ObjectAPI struct {
	svc *Service
}

// NewObjectAPI 构造 ObjectAPI。
func NewObjectAPI(svc *Service) *ObjectAPI { return &ObjectAPI{svc: svc} }

// ---- Task ----

// ListTasks 按条件查询 Task。
func (h *ObjectAPI) ListTasks(ctx context.Context, req httpapi.ListTasksRequestObject) (httpapi.ListTasksResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	limit := httpx.PageLimit(req.Params.Limit)
	filter := TaskFilter{
		ListID:      req.Params.ListId,
		ProjectID:   req.Params.ProjectId,
		Query:       req.Params.Q,
		Unscheduled: req.Params.Unscheduled != nil && *req.Params.Unscheduled,
		// 多取一条用于判断是否还有下一页。
		Limit: limit + 1,
	}
	if req.Params.Status != nil {
		for _, s := range *req.Params.Status {
			filter.Statuses = append(filter.Statuses, string(s))
		}
	}
	if req.Params.DueBefore != nil {
		d := req.Params.DueBefore.Time
		filter.DueBefore = &d
	}
	if req.Params.Day != nil {
		tz, err := h.svc.userTimezone(ctx, userID)
		if err != nil {
			return nil, err
		}
		day := timeutil.DayOf(req.Params.Day.Time, timeutil.LoadLocation(tz))
		filter.Day = &day.Date
		filter.DayStart = &day.Start
		filter.DayEnd = &day.End
	}
	if req.Params.ScheduledOn != nil {
		tz, err := h.svc.userTimezone(ctx, userID)
		if err != nil {
			return nil, err
		}
		day := timeutil.DayOf(req.Params.ScheduledOn.Time, timeutil.LoadLocation(tz))
		filter.ScheduledFrom = &day.Start
		filter.ScheduledTo = &day.End
	}
	if cursor != nil {
		filter.CursorTime = &cursor.Time
		filter.CursorID = &cursor.ID
	}

	rows, err := h.svc.ListTasks(ctx, userID, filter)
	if err != nil {
		return nil, err
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Task, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapTask(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListTasks200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateTask 新建 Task。
func (h *ObjectAPI) CreateTask(ctx context.Context, req httpapi.CreateTaskRequestObject) (httpapi.CreateTaskResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.CreateTask(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateTask201JSONResponse{Data: MapTask(created), Meta: httpx.Meta(ctx)}, nil
}

// GetTask 读取 Task 详情。
func (h *ObjectAPI) GetTask(ctx context.Context, req httpapi.GetTaskRequestObject) (httpapi.GetTaskResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetTask(ctx, userID, req.TaskId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetTask200JSONResponse{Data: MapTask(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateTask 修改 Task。
func (h *ObjectAPI) UpdateTask(ctx context.Context, req httpapi.UpdateTaskRequestObject) (httpapi.UpdateTaskResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := h.svc.UpdateTask(ctx, userID, req.TaskId, TaskUpdate{
		Body:            *req.Body,
		ExpectedVersion: httpx.ParseIfMatch(req.Params.IfMatch),
	})
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateTask200JSONResponse{Data: MapTask(updated), Meta: httpx.Meta(ctx)}, nil
}

// DeleteTask 删除 Task。
func (h *ObjectAPI) DeleteTask(ctx context.Context, req httpapi.DeleteTaskRequestObject) (httpapi.DeleteTaskResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteTask(ctx, userID, req.TaskId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteTask200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeTask, req.TaskId),
		httpx.Resource(httpapi.AffectedResourceTypeToday, ""),
		httpx.Resource(httpapi.AffectedResourceTypeCalendar, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// ---- Event ----

// ListEvents 按时间范围查询 Event。
func (h *ObjectAPI) ListEvents(ctx context.Context, req httpapi.ListEventsRequestObject) (httpapi.ListEventsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	limit := httpx.PageLimit(req.Params.Limit)
	filter := EventFilter{ProjectID: req.Params.ProjectId, Limit: limit + 1}
	if req.Params.EventKind != nil {
		kind := string(*req.Params.EventKind)
		filter.Kind = &kind
	}
	if req.Params.From != nil {
		d := req.Params.From.Time
		filter.FromDate = &d
	}
	if req.Params.To != nil {
		d := req.Params.To.Time
		filter.ToDate = &d
	}
	if cursor != nil {
		filter.CursorTime = &cursor.Time
		filter.CursorID = &cursor.ID
	}

	rows, tz, err := h.svc.ListEvents(ctx, userID, filter)
	if err != nil {
		return nil, err
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}

	var data []httpapi.Event
	if filter.FromDate != nil && filter.ToDate != nil {
		loc := timeutil.LoadLocation(tz)
		data = ProjectYearlyEvents(rows,
			timeutil.DayOf(*filter.FromDate, loc).Start,
			timeutil.DayOf(*filter.ToDate, loc).End, tz)
	} else {
		data = make([]httpapi.Event, 0, len(rows))
		for _, row := range rows {
			data = append(data, MapEvent(row))
		}
	}

	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListEvents200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateEvent 新建 Event。
func (h *ObjectAPI) CreateEvent(ctx context.Context, req httpapi.CreateEventRequestObject) (httpapi.CreateEventResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.CreateEvent(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateEvent201JSONResponse{Data: MapEvent(created), Meta: httpx.Meta(ctx)}, nil
}

// GetEvent 读取 Event 详情。
func (h *ObjectAPI) GetEvent(ctx context.Context, req httpapi.GetEventRequestObject) (httpapi.GetEventResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetEvent(ctx, userID, req.EventId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetEvent200JSONResponse{Data: MapEvent(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateEvent 修改 Event。
func (h *ObjectAPI) UpdateEvent(ctx context.Context, req httpapi.UpdateEventRequestObject) (httpapi.UpdateEventResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := h.svc.UpdateEvent(ctx, userID, req.EventId, EventUpdate{
		Body:            *req.Body,
		ExpectedVersion: httpx.ParseIfMatch(req.Params.IfMatch),
	})
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateEvent200JSONResponse{Data: MapEvent(updated), Meta: httpx.Meta(ctx)}, nil
}

// DeleteEvent 删除 Event。
func (h *ObjectAPI) DeleteEvent(ctx context.Context, req httpapi.DeleteEventRequestObject) (httpapi.DeleteEventResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteEvent(ctx, userID, req.EventId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteEvent200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeEvent, req.EventId),
		httpx.Resource(httpapi.AffectedResourceTypeToday, ""),
		httpx.Resource(httpapi.AffectedResourceTypeCalendar, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// ---- Project ----

// ListProjects 查询 Project。
func (h *ObjectAPI) ListProjects(ctx context.Context, req httpapi.ListProjectsRequestObject) (httpapi.ListProjectsResponseObject, error) {
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

	var projectKind *string
	if req.Params.ProjectKind != nil {
		kind := string(*req.Params.ProjectKind)
		projectKind = &kind
	}

	rows, err := h.svc.ListProjects(ctx, userID, statuses, projectKind, cursorTime, cursorID, limit+1)
	if err != nil {
		return nil, err
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Project, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapProject(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1].Row
		next = httpx.EncodeCursor(last.CreatedAt, last.ID)
	}
	return httpapi.ListProjects200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateProject 新建 Project。
func (h *ObjectAPI) CreateProject(ctx context.Context, req httpapi.CreateProjectRequestObject) (httpapi.CreateProjectResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.CreateProject(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateProject201JSONResponse{Data: MapProject(created), Meta: httpx.Meta(ctx)}, nil
}

// GetProject 读取 Project 详情。
func (h *ObjectAPI) GetProject(ctx context.Context, req httpapi.GetProjectRequestObject) (httpapi.GetProjectResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetProject(ctx, userID, req.ProjectId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetProject200JSONResponse{Data: MapProject(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateProject 修改 Project。
func (h *ObjectAPI) UpdateProject(ctx context.Context, req httpapi.UpdateProjectRequestObject) (httpapi.UpdateProjectResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := h.svc.UpdateProject(ctx, userID, req.ProjectId, ProjectUpdate{
		Body:            *req.Body,
		ExpectedVersion: httpx.ParseIfMatch(req.Params.IfMatch),
	})
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateProject200JSONResponse{Data: MapProject(updated), Meta: httpx.Meta(ctx)}, nil
}

// DeleteProject 删除 Project。
func (h *ObjectAPI) DeleteProject(ctx context.Context, req httpapi.DeleteProjectRequestObject) (httpapi.DeleteProjectResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteProject(ctx, userID, req.ProjectId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteProject200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeProject, req.ProjectId),
		httpx.Resource(httpapi.AffectedResourceTypeTask, ""),
		httpx.Resource(httpapi.AffectedResourceTypeEvent, ""),
		httpx.Resource(httpapi.AffectedResourceTypeNote, ""),
		httpx.Resource(httpapi.AffectedResourceTypeRecord, ""),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// ---- Note ----

// ListNotes 查询 Note。
func (h *ObjectAPI) ListNotes(ctx context.Context, req httpapi.ListNotesRequestObject) (httpapi.ListNotesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := httpx.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}

	limit := httpx.PageLimit(req.Params.Limit)
	filter := NoteFilter{
		Tag:       req.Params.Tag,
		ProjectID: req.Params.ProjectId,
		Query:     req.Params.Q,
		Limit:     limit + 1,
	}
	if cursor != nil {
		filter.CursorTime = &cursor.Time
		filter.CursorID = &cursor.ID
	}

	rows, err := h.svc.ListNotes(ctx, userID, filter)
	if err != nil {
		return nil, err
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.Note, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapNote(row))
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.UpdatedAt, last.ID)
	}
	return httpapi.ListNotes200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateNote 新建 Note。
func (h *ObjectAPI) CreateNote(ctx context.Context, req httpapi.CreateNoteRequestObject) (httpapi.CreateNoteResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.CreateNote(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateNote201JSONResponse{Data: MapNote(created), Meta: httpx.Meta(ctx)}, nil
}

// GetNote 读取 Note 详情。
func (h *ObjectAPI) GetNote(ctx context.Context, req httpapi.GetNoteRequestObject) (httpapi.GetNoteResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.GetNote(ctx, userID, req.NoteId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetNote200JSONResponse{Data: MapNote(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateNote 修改 Note。
func (h *ObjectAPI) UpdateNote(ctx context.Context, req httpapi.UpdateNoteRequestObject) (httpapi.UpdateNoteResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	updated, err := h.svc.UpdateNote(ctx, userID, req.NoteId, NoteUpdate{
		Body:            *req.Body,
		ExpectedVersion: httpx.ParseIfMatch(req.Params.IfMatch),
	})
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateNote200JSONResponse{Data: MapNote(updated), Meta: httpx.Meta(ctx)}, nil
}

// DeleteNote 删除 Note。
func (h *ObjectAPI) DeleteNote(ctx context.Context, req httpapi.DeleteNoteRequestObject) (httpapi.DeleteNoteResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.DeleteNote(ctx, userID, req.NoteId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteNote200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeNote, req.NoteId),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// userTimezone 在独立短事务中读取用户时区，供不进入写事务的查询路径使用。
func (s *Service) userTimezone(ctx context.Context, userID string) (string, error) {
	var tz string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		zone, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		tz = zone
		return nil
	})
	return tz, err
}
