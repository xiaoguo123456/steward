package objects

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// TaskFilter 是 Task 列表查询条件。
type TaskFilter struct {
	Statuses      []string
	ListID        *string
	ListKind      *string
	ProjectID     *string
	PersonID      *string
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
			PersonID:        f.PersonID,
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
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "tasks.create", body)
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &out); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
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
		if body.PersonId != nil {
			if s.people == nil {
				return apperr.Internal(fmt.Errorf("亲友关联能力未初始化"))
			}
			if err := s.people.LinkTask(ctx, q, userID, created.ID, *body.PersonId); err != nil {
				return err
			}
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
		return saveObjectReplay(ctx, q, userID, "tasks.create", requestHash, 201, created.ID, out)
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
	return s.updateTaskInTx(ctx, q, userID, taskID, in, source, sourceID, true)
}

// UpdateTaskCommandInTx 在 Capture 确认事务内执行 Task 更新。
//
// expectedVersion 是必填值，避免 AI 候选在目标已经变化后覆盖用户的新修改。
// Activity 由 Capture 对整个确认批次统一记录，避免一个确认被拆成多个批次。
func (s *Service) UpdateTaskCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, taskID string, body httpapi.UpdateTaskRequest, expectedVersion int32) (dbgen.Task, error) {
	updated, _, err := s.updateTaskInTx(ctx, q, userID, taskID, TaskUpdate{
		Body: body, ExpectedVersion: &expectedVersion,
	}, activity.SourceCaptureConfirm, nil, false)
	return updated, err
}

func (s *Service) updateTaskInTx(ctx context.Context, q *dbgen.Queries,
	userID, taskID string, in TaskUpdate, source activity.Source, sourceID *string,
	recordActivity bool) (dbgen.Task, string, error) {

	fail := func(err error) (dbgen.Task, string, error) { return dbgen.Task{}, "", err }

	current, err := q.GetTaskForUpdate(ctx, taskID)
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

	// PATCH 必须先与当前行合并，再校验完整时间状态。只看请求片段会漏掉
	// “清除截止但保留旧提醒”“只改开始时间导致结束早于开始”等组合。
	timing, err := resolveTaskUpdateTiming(current, body, clear, tz)
	if err != nil {
		return fail(err)
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
		DueDate:               timing.dueDate,
		ClearDueDate:          timing.dueDate == nil,
		DueAt:                 timing.dueAt,
		ClearDueAt:            timing.dueAt == nil,
		DueTimezone:           timing.dueTimezone,
		ScheduledStartAt:      timing.scheduledStartAt,
		ClearScheduledStartAt: timing.scheduledStartAt == nil,
		ScheduledEndAt:        timing.scheduledEndAt,
		ClearScheduledEndAt:   timing.scheduledEndAt == nil,
		ScheduledTimezone:     timing.scheduledTimezone,
		EstimatedMinutes:      estimated,
		ClearEstimatedMinutes: clear.EstimatedMinutes,
		FocusDate:             timePtrOfDate(body.FocusDate),
		ClearFocusDate:        clear.FocusDate,
		ListID:                body.ListId,
		ProjectID:             body.ProjectId,
		ClearProjectID:        clear.ProjectID,
		Reminders:             timing.remindersJSON,
		ClearReminders:        len(timing.reminders) == 0,
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
	if !recordActivity {
		return updated, "", nil
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
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "tasks.delete", map[string]string{"task_id": taskID})
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &batchID); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		current, err := q.GetTaskForUpdate(ctx, taskID)
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
		if err != nil {
			return err
		}
		return saveObjectReplay(ctx, q, userID, "tasks.delete", requestHash, 200, batchID, batchID)
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
