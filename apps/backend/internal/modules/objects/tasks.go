package objects

import (
	"context"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// TaskFilter 是 Task 列表查询条件。
type TaskFilter struct {
	Statuses      []string
	ListID        *string
	ListKind      *string
	ProjectID     *string
	DueFrom       *time.Time
	DueBefore     *time.Time
	ScheduledFrom *time.Time
	ScheduledTo   *time.Time
	Unscheduled   bool
	CompletedFrom *time.Time
	CompletedTo   *time.Time
	// Day 复用 Today 的收录规则，按当地日期筛选需要关注的 Task。
	Day        *time.Time
	DayStart   *time.Time
	DayEnd     *time.Time
	Query      *string
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// ListTasks 按条件查询 Task。
func (s *Service) ListTasks(ctx context.Context, userID string, f TaskFilter) ([]dbgen.Task, error) {
	statuses := f.Statuses
	if len(statuses) == 0 {
		// 契约约定：不传 status 时只返回未完成的任务。
		statuses = []string{"todo", "doing"}
	}

	var out []dbgen.Task
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses:        statuses,
			ListID:          f.ListID,
			ListKind:        f.ListKind,
			ProjectID:       f.ProjectID,
			DueFrom:         f.DueFrom,
			DueBefore:       f.DueBefore,
			ScheduledFrom:   f.ScheduledFrom,
			ScheduledTo:     f.ScheduledTo,
			Unscheduled:     f.Unscheduled,
			CompletedFrom:   f.CompletedFrom,
			CompletedTo:     f.CompletedTo,
			Day:             f.Day,
			DayStart:        f.DayStart,
			DayEnd:          f.DayEnd,
			Query:           f.Query,
			CursorCreatedAt: f.CursorTime,
			CursorID:        f.CursorID,
			RowLimit:        f.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// GetTask 读取单个 Task。
func (s *Service) GetTask(ctx context.Context, userID, taskID string) (dbgen.Task, error) {
	var out dbgen.Task
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetTask(ctx, taskID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("任务")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// CreateTask 新建 Task。
func (s *Service) CreateTask(ctx context.Context, userID string, body httpapi.CreateTaskRequest) (dbgen.Task, error) {
	title := strings.TrimSpace(body.Title)
	if title == "" {
		return dbgen.Task{}, apperr.Validation(apperr.Field("title", "任务标题不能为空。"))
	}

	var out dbgen.Task
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		listID, err := s.lists.ResolveListID(ctx, q, userID, body.ListId)
		if err != nil {
			return err
		}

		dueDate, dueAt, dueTZ, err := resolveDue(dueInput{
			DueDate:  body.DueDate,
			DueAt:    body.DueAt,
			Timezone: body.DueTimezone,
		}, tz)
		if err != nil {
			return err
		}
		schedStart, schedEnd, schedTZ, err := resolveSchedule(
			body.ScheduledStartAt, body.ScheduledEndAt, body.ScheduledTimezone, tz)
		if err != nil {
			return err
		}
		if body.EstimatedMinutes != nil && *body.EstimatedMinutes <= 0 {
			return apperr.Validation(apperr.Field("estimated_minutes", "预计时长必须是正整数。"))
		}

		// 只有带明确时刻的截止才允许相对提醒。
		reminders, err := buildReminders(body.Reminders, dueAt != nil)
		if err != nil {
			return err
		}
		if len(reminders) > 0 && dueDate == nil && dueAt == nil {
			return apperr.Validation(apperr.Field(
				"reminders", "没有截止信息时不能设置提醒。"))
		}
		remindersJSON, err := marshalJSON(reminders)
		if err != nil {
			return err
		}

		status := "todo"
		if body.Status != nil {
			status = string(*body.Status)
		}
		priority := "normal"
		if body.Priority != nil {
			priority = string(*body.Priority)
		}
		var completedAt *time.Time
		if status == "done" {
			now := time.Now()
			completedAt = &now
		}

		if body.ProjectId != nil {
			if err := s.assertProjectExists(ctx, q, *body.ProjectId); err != nil {
				return err
			}
		}

		var estimated *int32
		if body.EstimatedMinutes != nil {
			v := int32(*body.EstimatedMinutes)
			estimated = &v
		}

		created, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
			ID:                idgen.New(idgen.PrefixTask),
			UserID:            userID,
			Title:             title,
			Description:       body.Description,
			Status:            status,
			Priority:          priority,
			DueDate:           dueDate,
			DueAt:             dueAt,
			DueTimezone:       dueTZ,
			ScheduledStartAt:  schedStart,
			ScheduledEndAt:    schedEnd,
			ScheduledTimezone: schedTZ,
			EstimatedMinutes:  estimated,
			FocusDate:         timePtrOfDate(body.FocusDate),
			ListID:            listID,
			ProjectID:         body.ProjectId,
			Reminders:         remindersJSON,
			CompletedAt:       completedAt,
			QuantityText:      trimmedOrNil(body.QuantityText),
			// 品类由服务端算，不接受客户端指定：同一件东西在两台设备上
			// 必须归到同一类。
			ShoppingCategory: shoppingCategoryFor(ctx, q, listID, title),
			CreatedBy:        "user",
			ProvenanceRefs:   emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "task",
				ResourceID:   created.ID,
				Title:        created.Title,
				Summary:      "创建了任务",
			}}); err != nil {
			return err
		}

		out = created
		return nil
	})
	return out, err
}

// TaskUpdate 是 Task 的修改意图，已经把契约里的 clear 数组展开成布尔标记。
type TaskUpdate struct {
	Body            httpapi.UpdateTaskRequest
	ExpectedVersion *int32
}

// UpdateTask 修改 Task。
func (s *Service) UpdateTask(ctx context.Context, userID, taskID string, in TaskUpdate) (dbgen.Task, error) {
	var out dbgen.Task
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		task, _, err := s.UpdateTaskInTx(ctx, q, userID, taskID, in, activity.SourceUserForm, nil)
		if err != nil {
			return err
		}
		out = task
		return nil
	})
	return out, err
}

// UpdateTaskInTx 在调用方的事务内修改 Task，并返回 Activity 批次 ID。
//
// Assistant 的建议确认需要把「重新校验 + 写入 + Activity」放在同一个事务里，
// 因此这里把事务边界交给调用方，而不是自己开一个。
func (s *Service) UpdateTaskInTx(ctx context.Context, q *dbgen.Queries,
	userID, taskID string, in TaskUpdate,
	source activity.Source, sourceID *string) (dbgen.Task, string, error) {

	fail := func(err error) (dbgen.Task, string, error) { return dbgen.Task{}, "", err }

	current, err := q.GetTask(ctx, taskID)
	if err != nil {
		if database.IsNoRows(err) {
			return fail(apperr.NotFound("任务"))
		}
		return fail(apperr.Internal(err))
	}
	if in.ExpectedVersion != nil && *in.ExpectedVersion != current.Version {
		return fail(apperr.New(apperr.CodeVersionConflict))
	}

	clear := taskClearFlagsOf(in.Body.Clear)
	body := in.Body

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return fail(err)
	}

	// 状态转换必须经过状态机。
	var completedAt *time.Time
	setCompletedAt := false
	var status *string
	if body.Status != nil {
		next := string(*body.Status)
		if err := validateTaskStatusTransition(current.Status, next); err != nil {
			return fail(err)
		}
		status = &next
		setCompletedAt = true
		if next == "done" {
			now := time.Now()
			completedAt = &now
		}
	}

	// 补充具体时刻时用 due_at 取代原 due_date，反之亦然；
	// 这条规则在 SQL 里已经实现，这里只做互斥校验。
	if body.DueDate != nil && body.DueAt != nil {
		return fail(apperr.Validation(apperr.Field("due_at", "截止日期与截止时刻不能同时设置。")))
	}
	var dueTZ *string
	if body.DueDate != nil || body.DueAt != nil {
		zone := tz
		if body.DueTimezone != nil && strings.TrimSpace(*body.DueTimezone) != "" {
			zone = *body.DueTimezone
		}
		if err := timeutil.ValidateLocation(zone); err != nil {
			return fail(apperr.Validation(apperr.Field("due_timezone", "时区名称不合法。")))
		}
		dueTZ = &zone
	}

	if body.ScheduledEndAt != nil {
		start := body.ScheduledStartAt
		if start == nil {
			start = current.ScheduledStartAt
		}
		if start == nil {
			return fail(apperr.Validation(apperr.Field(
				"scheduled_start_at", "设置计划结束时间前必须先设置开始时间。")))
		}
		if !body.ScheduledEndAt.After(*start) {
			return fail(apperr.Validation(apperr.Field(
				"scheduled_end_at", "计划结束时间必须晚于开始时间。")))
		}
	}
	var schedTZ *string
	if body.ScheduledStartAt != nil {
		zone := tz
		if body.ScheduledTimezone != nil && strings.TrimSpace(*body.ScheduledTimezone) != "" {
			zone = *body.ScheduledTimezone
		}
		if err := timeutil.ValidateLocation(zone); err != nil {
			return fail(apperr.Validation(apperr.Field("scheduled_timezone", "时区名称不合法。")))
		}
		schedTZ = &zone
	}

	if body.ProjectId != nil {
		if err := s.assertProjectExists(ctx, q, *body.ProjectId); err != nil {
			return fail(err)
		}
	}
	if body.ListId != nil {
		if _, err := s.lists.ResolveListID(ctx, q, userID, body.ListId); err != nil {
			return fail(err)
		}
	}

	var remindersJSON []byte
	if body.Reminders != nil {
		willHaveDueAt := body.DueAt != nil || (current.DueAt != nil && !clear.DueAt)
		reminders, err := buildReminders(body.Reminders, willHaveDueAt)
		if err != nil {
			return fail(err)
		}
		remindersJSON, err = marshalJSON(reminders)
		if err != nil {
			return fail(err)
		}
	}

	var estimated *int32
	if body.EstimatedMinutes != nil {
		if *body.EstimatedMinutes <= 0 {
			return fail(apperr.Validation(apperr.Field("estimated_minutes", "预计时长必须是正整数。")))
		}
		v := int32(*body.EstimatedMinutes)
		estimated = &v
	}

	updated, err := q.UpdateTask(ctx, dbgen.UpdateTaskParams{
		ID:                    taskID,
		Title:                 trimmedOrNil(body.Title),
		Description:           body.Description,
		ClearDescription:      clear.Description,
		Status:                status,
		Priority:              priorityOrNil(body.Priority),
		DueDate:               timePtrOfDate(body.DueDate),
		ClearDueDate:          clear.DueDate,
		DueAt:                 body.DueAt,
		ClearDueAt:            clear.DueAt,
		DueTimezone:           dueTZ,
		ScheduledStartAt:      body.ScheduledStartAt,
		ClearScheduledStartAt: clear.ScheduledStartAt,
		ScheduledEndAt:        body.ScheduledEndAt,
		ClearScheduledEndAt:   clear.ScheduledEndAt,
		ScheduledTimezone:     schedTZ,
		EstimatedMinutes:      estimated,
		ClearEstimatedMinutes: clear.EstimatedMinutes,
		FocusDate:             timePtrOfDate(body.FocusDate),
		ClearFocusDate:        clear.FocusDate,
		ListID:                body.ListId,
		ProjectID:             body.ProjectId,
		ClearProjectID:        clear.ProjectID,
		Reminders:             remindersJSON,
		ClearReminders:        clear.Reminders,
		QuantityText:          trimmedOrNil(body.QuantityText),
		ClearQuantityText:     clear.QuantityText,
		// 改了名字就重新分类：用户把「牛奶」改成「咖啡豆」之后，
		// 它不该还留在蛋奶那一组。
		ShoppingCategory: reclassifyOnTitleChange(current, body.Title),
		SetCompletedAt:   setCompletedAt,
		CompletedAt:      completedAt,
	})
	if err != nil {
		return fail(apperr.Internal(err))
	}

	action := "updated"
	summary := "修改了任务"
	if status != nil {
		switch *status {
		case "done":
			action, summary = "completed", "完成了任务"
		case "todo":
			if current.Status == "done" || current.Status == "cancelled" {
				action, summary = "reopened", "重新打开了任务"
			}
		}
	}
	batchID, err := s.activity.Record(ctx, q, userID, source, sourceID,
		[]activity.EntryInput{{
			Action:       action,
			ResourceType: "task",
			ResourceID:   updated.ID,
			Title:        updated.Title,
			Summary:      summary,
			BeforeState:  taskUndoState(current),
			AfterState:   taskUndoState(updated),
		}})
	if err != nil {
		return fail(err)
	}
	return updated, batchID, nil
}

// DeleteTask 软删除 Task。
func (s *Service) DeleteTask(ctx context.Context, userID, taskID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetTask(ctx, taskID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("任务")
			}
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteTask(ctx, taskID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "task",
				ResourceID:   taskID,
				Title:        current.Title,
				Summary:      "删除了任务",
				BeforeState:  taskUndoState(current),
			}})
		return err
	})
	return batchID, err
}

// assertProjectExists 校验 Project 归属。RLS 已保证跨用户不可见，
// 这里再确认一次以便返回明确的错误码而不是外键报错。
func (s *Service) assertProjectExists(ctx context.Context, q *dbgen.Queries, projectID string) error {
	if _, err := q.GetProject(ctx, projectID); err != nil {
		if database.IsNoRows(err) {
			return apperr.NotFound("项目")
		}
		return apperr.Internal(err)
	}
	return nil
}

// taskClearFlags 把契约里的 clear 数组展开成布尔标记。
type taskClearFlags struct {
	Description      bool
	DueDate          bool
	DueAt            bool
	ScheduledStartAt bool
	ScheduledEndAt   bool
	EstimatedMinutes bool
	FocusDate        bool
	ProjectID        bool
	Reminders        bool
	QuantityText     bool
}

func taskClearFlagsOf(clear *[]httpapi.UpdateTaskRequestClear) taskClearFlags {
	var f taskClearFlags
	if clear == nil {
		return f
	}
	for _, item := range *clear {
		switch item {
		case httpapi.UpdateTaskRequestClearDescription:
			f.Description = true
		case httpapi.UpdateTaskRequestClearDueDate:
			f.DueDate = true
		case httpapi.UpdateTaskRequestClearDueAt:
			f.DueAt = true
		case httpapi.UpdateTaskRequestClearScheduledStartAt:
			f.ScheduledStartAt = true
		case httpapi.UpdateTaskRequestClearScheduledEndAt:
			f.ScheduledEndAt = true
		case httpapi.UpdateTaskRequestClearEstimatedMinutes:
			f.EstimatedMinutes = true
		case httpapi.UpdateTaskRequestClearFocusDate:
			f.FocusDate = true
		case httpapi.UpdateTaskRequestClearProjectId:
			f.ProjectID = true
		case httpapi.UpdateTaskRequestClearReminders:
			f.Reminders = true
		case httpapi.UpdateTaskRequestClearQuantityText:
			f.QuantityText = true
		}
	}
	return f
}

// taskUndoState 是撤销所需的最小状态快照。
func taskUndoState(t dbgen.Task) map[string]any {
	return map[string]any{
		"title":       t.Title,
		"status":      t.Status,
		"priority":    t.Priority,
		"list_id":     t.ListID,
		"focus_date":  t.FocusDate,
		"due_date":    t.DueDate,
		"due_at":      t.DueAt,
		"deleted":     t.DeletedAt != nil,
		"version":     t.Version,
		"description": t.Description,
	}
}

func trimmedOrNil(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

func priorityOrNil(p *httpapi.TaskPriority) *string {
	if p == nil {
		return nil
	}
	v := string(*p)
	return &v
}

// shoppingCategoryFor 只在购物清单里返回品类。
//
// 普通任务不需要品类；给它塞一个只会让「其他」这一组出现在
// 完全不相干的地方。
func shoppingCategoryFor(ctx context.Context, q *dbgen.Queries,
	listID, title string) *string {

	list, err := q.GetTaskList(ctx, listID)
	if err != nil || list.ListKind != "shopping" {
		return nil
	}
	category := string(ClassifyShoppingItem(title))
	return &category
}

// reclassifyOnTitleChange 在标题变化时重新分类。
//
// 返回 nil 表示不改动已有值：SQL 里用的是 coalesce，
// 因此不能用它来清空，只能用来覆盖。
func reclassifyOnTitleChange(current dbgen.Task, title *string) *string {

	if title == nil || strings.TrimSpace(*title) == "" {
		return nil
	}
	if current.ShoppingCategory == nil {
		// 本来就不是购物条目，改名不该给它凭空加一个品类。
		return nil
	}
	category := string(ClassifyShoppingItem(strings.TrimSpace(*title)))
	return &category
}
