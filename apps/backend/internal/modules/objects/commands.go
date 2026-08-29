package objects

import (
	"context"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/domain/notecontent"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 事务内的公开 Command。
//
// 这些方法接受调用方的 *dbgen.Queries，因此 Capture 确认可以把
// Tracker、Object 创建与 Relation 变更放进同一个事务，任一失败整体回滚。
// 它们不自行开启事务，也不写 Activity：批次由调用方统一记录。

// ProvenanceInput 描述实体的来源引用。
type ProvenanceInput struct {
	SourceType     string   `json:"source_type"`
	SourceID       string   `json:"source_id"`
	SourceRevision *int     `json:"source_revision,omitempty"`
	PartRefs       []string `json:"part_refs,omitempty"`
	Action         string   `json:"action"`
}

// CreateTaskCommand 是事务内创建 Task 的输入。
type CreateTaskCommand struct {
	Title             string
	Description       *string
	Priority          string
	DueDate           *time.Time
	DueAt             *time.Time
	DueTimezone       string
	ScheduledStartAt  *time.Time
	ScheduledEndAt    *time.Time
	ScheduledTimezone string
	EstimatedMinutes  *int32
	FocusDate         *time.Time
	ListID            string
	ProjectID         *string
	CreatedBy         string
	Provenance        []ProvenanceInput
}

// CreateTaskInTx 在调用方事务内创建 Task。
func (s *Service) CreateTaskInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd CreateTaskCommand) (dbgen.Task, error) {
	title := strings.TrimSpace(cmd.Title)
	if title == "" {
		return dbgen.Task{}, apperr.Validation(apperr.Field("title", "任务标题不能为空。"))
	}
	if cmd.DueDate != nil && cmd.DueAt != nil {
		return dbgen.Task{}, apperr.Validation(apperr.Field("due_at", "截止日期与截止时刻不能同时设置。"))
	}
	if cmd.ProjectID != nil {
		if err := s.assertProjectExists(ctx, q, *cmd.ProjectID); err != nil {
			return dbgen.Task{}, err
		}
	}

	listID := cmd.ListID
	if listID == "" {
		resolved, err := s.lists.ResolveListID(ctx, q, userID, nil)
		if err != nil {
			return dbgen.Task{}, err
		}
		listID = resolved
	}

	var dueTZ *string
	if cmd.DueDate != nil || cmd.DueAt != nil {
		tz := cmd.DueTimezone
		if tz == "" {
			tz = timeutil.DefaultTimezone
		}
		dueTZ = &tz
	}
	var schedTZ *string
	if cmd.ScheduledStartAt != nil {
		tz := cmd.ScheduledTimezone
		if tz == "" {
			tz = timeutil.DefaultTimezone
		}
		schedTZ = &tz
	}

	provJSON, err := marshalJSON(cmd.Provenance)
	if err != nil {
		return dbgen.Task{}, err
	}
	createdBy := cmd.CreatedBy
	if createdBy == "" {
		createdBy = "user"
	}
	priority := cmd.Priority
	if priority == "" {
		priority = "normal"
	}

	row, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
		ID:                idgen.New(idgen.PrefixTask),
		UserID:            userID,
		Title:             title,
		Description:       cmd.Description,
		Status:            "todo",
		Priority:          priority,
		DueDate:           cmd.DueDate,
		DueAt:             cmd.DueAt,
		DueTimezone:       dueTZ,
		ScheduledStartAt:  cmd.ScheduledStartAt,
		ScheduledEndAt:    cmd.ScheduledEndAt,
		ScheduledTimezone: schedTZ,
		EstimatedMinutes:  cmd.EstimatedMinutes,
		FocusDate:         cmd.FocusDate,
		ListID:            listID,
		ProjectID:         cmd.ProjectID,
		Reminders:         emptyJSONArray,
		CreatedBy:         createdBy,
		ProvenanceRefs:    provJSON,
	})
	if err != nil {
		return dbgen.Task{}, apperr.Internal(err)
	}
	return row, nil
}

// CreateEventCommand 是事务内创建 Event 的输入。
type CreateEventCommand struct {
	Title            string
	EventKind        string
	AllDay           bool
	StartAt          *time.Time
	EndAt            *time.Time
	StartDate        *time.Time
	EndDate          *time.Time
	Timezone         string
	Location         *string
	Note             *string
	Recurrence       string
	ProjectID        *string
	ItineraryDetails *httpapi.ItineraryEventDetails
	CreatedBy        string
	Provenance       []ProvenanceInput
}

// CreateEventInTx 在调用方事务内创建 Event。
func (s *Service) CreateEventInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd CreateEventCommand) (dbgen.Event, error) {
	title := strings.TrimSpace(cmd.Title)
	if title == "" {
		return dbgen.Event{}, apperr.Validation(apperr.Field("title", "标题不能为空。"))
	}
	if err := validateEventTiming(cmd.AllDay, cmd.StartAt, cmd.EndAt, cmd.StartDate, cmd.EndDate); err != nil {
		return dbgen.Event{}, err
	}

	kind := cmd.EventKind
	if kind == "" {
		kind = "schedule"
	}
	recurrence := cmd.Recurrence
	if recurrence == "" {
		recurrence = "none"
	}
	if recurrence == "yearly" && kind != "important_date" {
		return dbgen.Event{}, apperr.New(apperr.CodeEventRecurrenceDenied)
	}
	if cmd.ProjectID != nil {
		if err := s.assertProjectExists(ctx, q, *cmd.ProjectID); err != nil {
			return dbgen.Event{}, err
		}
	}
	tz := cmd.Timezone
	if tz == "" {
		tz = timeutil.DefaultTimezone
	}
	itineraryJSON, err := s.normalizeItineraryDetails(ctx, q, userID, cmd.ItineraryDetails, itineraryState{
		ProjectID: cmd.ProjectID,
		AllDay:    cmd.AllDay,
		StartAt:   cmd.StartAt,
		EndAt:     cmd.EndAt,
		Location:  cmd.Location,
	})
	if err != nil {
		return dbgen.Event{}, err
	}

	var originalMonthDay *string
	if recurrence == "yearly" && cmd.StartDate != nil {
		md := timeutil.MonthDay(*cmd.StartDate)
		originalMonthDay = &md
	}
	provJSON, err := marshalJSON(cmd.Provenance)
	if err != nil {
		return dbgen.Event{}, err
	}
	createdBy := cmd.CreatedBy
	if createdBy == "" {
		createdBy = "user"
	}

	row, err := q.CreateEvent(ctx, dbgen.CreateEventParams{
		ID:               idgen.New(idgen.PrefixEvent),
		UserID:           userID,
		Title:            title,
		EventKind:        kind,
		AllDay:           cmd.AllDay,
		StartAt:          cmd.StartAt,
		EndAt:            cmd.EndAt,
		StartDate:        cmd.StartDate,
		EndDate:          cmd.EndDate,
		Timezone:         tz,
		Location:         cmd.Location,
		ItineraryDetails: itineraryJSON,
		Participants:     emptyJSONArray,
		ProjectID:        cmd.ProjectID,
		Note:             cmd.Note,
		Reminders:        emptyJSONArray,
		Recurrence:       recurrence,
		OriginalMonthDay: originalMonthDay,
		CreatedBy:        createdBy,
		ProvenanceRefs:   provJSON,
	})
	if err != nil {
		return dbgen.Event{}, apperr.Internal(err)
	}
	return row, nil
}

// CreateNoteCommand 是事务内创建 Note 的输入。
type CreateNoteCommand struct {
	Title      *string
	Content    string
	Tags       []string
	ProjectID  *string
	CreatedBy  string
	Provenance []ProvenanceInput
}

// CreateNoteInTx 在调用方事务内创建 Note。
func (s *Service) CreateNoteInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd CreateNoteCommand) (dbgen.Note, error) {
	content := strings.TrimSpace(cmd.Content)
	if content == "" {
		return dbgen.Note{}, apperr.Validation(apperr.Field("content", "笔记内容不能为空。"))
	}
	if cmd.ProjectID != nil {
		if err := s.assertProjectExists(ctx, q, *cmd.ProjectID); err != nil {
			return dbgen.Note{}, err
		}
	}
	provJSON, err := marshalJSON(cmd.Provenance)
	if err != nil {
		return dbgen.Note{}, err
	}
	createdBy := cmd.CreatedBy
	if createdBy == "" {
		createdBy = "user"
	}
	tags := cmd.Tags
	if tags == nil {
		tags = []string{}
	}
	contentDocument, _, err := notecontent.EncodePlainText(httpapi.NoteContentPlainText{
		Format: httpapi.PlainText,
		Text:   content,
	})
	if err != nil {
		return dbgen.Note{}, err
	}

	row, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
		ID:              idgen.New(idgen.PrefixNote),
		UserID:          userID,
		NoteKind:        "general",
		Title:           deriveNoteTitle(cmd.Title, content),
		Content:         content,
		ContentDocument: contentDocument,
		Attachments:     emptyJSONArray,
		Tags:            tags,
		ProjectID:       cmd.ProjectID,
		CreatedBy:       createdBy,
		ProvenanceRefs:  provJSON,
	})
	if err != nil {
		return dbgen.Note{}, apperr.Internal(err)
	}
	return row, nil
}

// CreateMoodNoteCommand 是心情日记模块在事务内创建专用 Note 的输入。
type CreateMoodNoteCommand struct {
	Title   *string
	Content httpapi.NoteContentBlocksV1
}

// CreateMoodNoteInTx 创建固定为 mood_journal 的 Note。结构字段仍由心情日记模块写入一对一扩展表。
func (s *Service) CreateMoodNoteInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd CreateMoodNoteCommand) (dbgen.Note, error) {
	document, plaintext, err := notecontent.EncodeBlocksV1(cmd.Content)
	if err != nil {
		return dbgen.Note{}, err
	}
	title := ""
	if cmd.Title != nil {
		title = strings.TrimSpace(*cmd.Title)
	}
	row, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
		ID:       idgen.New(idgen.PrefixNote),
		UserID:   userID,
		NoteKind: "mood_journal",
		// 日记标题是明确的可选用户输入。不能复用普通笔记的首行自动标题，
		// 否则详情会把同一句话同时显示为标题和正文。
		Title:           title,
		Content:         plaintext,
		ContentDocument: document,
		Attachments:     emptyJSONArray,
		Tags:            []string{},
		CreatedBy:       "user",
		ProvenanceRefs:  emptyJSONArray,
	})
	if err != nil {
		return dbgen.Note{}, apperr.Internal(err)
	}
	return row, nil
}

// CreateProjectCommand 是事务内创建 Project 的输入。
type CreateProjectCommand struct {
	Title       string
	Description *string
	StartDate   *time.Time
	TargetDate  *time.Time
	ProjectKind string
	CreatedBy   string
	Provenance  []ProvenanceInput
}

// CreateProjectInTx 在调用方事务内创建 Project。
func (s *Service) CreateProjectInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd CreateProjectCommand) (dbgen.Project, error) {
	title := strings.TrimSpace(cmd.Title)
	if title == "" {
		return dbgen.Project{}, apperr.Validation(apperr.Field("title", "项目名称不能为空。"))
	}
	if cmd.StartDate != nil && cmd.TargetDate != nil && cmd.TargetDate.Before(*cmd.StartDate) {
		return dbgen.Project{}, apperr.Validation(apperr.Field(
			"target_date", "目标完成日期不能早于开始日期。"))
	}
	projectKind := "general"
	if cmd.ProjectKind == "trip" {
		projectKind = "trip"
	}
	provJSON, err := marshalJSON(cmd.Provenance)
	if err != nil {
		return dbgen.Project{}, err
	}
	createdBy := cmd.CreatedBy
	if createdBy == "" {
		createdBy = "user"
	}

	row, err := q.CreateProject(ctx, dbgen.CreateProjectParams{
		ID:             idgen.New(idgen.PrefixProject),
		UserID:         userID,
		Title:          title,
		Description:    cmd.Description,
		Status:         "active",
		StartDate:      cmd.StartDate,
		TargetDate:     cmd.TargetDate,
		ProjectKind:    projectKind,
		CreatedBy:      createdBy,
		ProvenanceRefs: provJSON,
	})
	if err != nil {
		return dbgen.Project{}, apperr.Internal(err)
	}
	return row, nil
}

// UndoEntry 还原一条 Task/Event/Note/Project 变更，实现 activity.Undoer。
//
// 目标在本批次之后再次变化时返回 VERSION_CONFLICT：
// 撤销不能覆盖用户后来的修改。
func (s *Service) UndoEntry(ctx context.Context, q *dbgen.Queries, userID string, entry dbgen.ActivityEntry) error {
	switch entry.ResourceType {
	case "task":
		return s.undoTask(ctx, q, entry)
	case "event":
		return s.undoEvent(ctx, q, entry)
	case "note":
		return s.undoNote(ctx, q, entry)
	case "project":
		return s.undoProject(ctx, q, entry)
	default:
		return apperr.Newf(apperr.CodeValidationFailed, "这类内容暂不支持撤销。")
	}
}

// Handles 报告本模块负责哪些资源类型的撤销。
func (s *Service) Handles(resourceType string) bool {
	switch resourceType {
	case "task", "event", "note", "project":
		return true
	default:
		return false
	}
}

func (s *Service) undoTask(ctx context.Context, q *dbgen.Queries, entry dbgen.ActivityEntry) error {
	switch entry.Action {
	case "created":
		if _, err := q.SoftDeleteTask(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "deleted":
		if _, err := q.RestoreTask(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "updated", "completed", "reopened":
		before, err := decodeUndoState(entry.BeforeState)
		if err != nil {
			return err
		}
		status, _ := before["status"].(string)
		if status == "" {
			return apperr.Newf(apperr.CodeValidationFailed, "缺少可还原的原始状态。")
		}
		setCompleted := true
		var completedAt *time.Time
		if _, err := q.UpdateTask(ctx, dbgen.UpdateTaskParams{
			ID:             entry.ResourceID,
			Status:         &status,
			SetCompletedAt: setCompleted,
			CompletedAt:    completedAt,
		}); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

func (s *Service) undoEvent(ctx context.Context, q *dbgen.Queries, entry dbgen.ActivityEntry) error {
	switch entry.Action {
	case "created":
		if _, err := q.SoftDeleteEvent(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "deleted":
		if _, err := q.RestoreEvent(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

func (s *Service) undoNote(ctx context.Context, q *dbgen.Queries, entry dbgen.ActivityEntry) error {
	switch entry.Action {
	case "created":
		if _, err := q.SoftDeleteNote(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "deleted":
		if _, err := q.RestoreNote(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "updated":
		before, err := decodeUndoState(entry.BeforeState)
		if err != nil {
			return err
		}
		title, _ := before["title"].(string)
		content, _ := before["content"].(string)
		if content == "" {
			return apperr.Newf(apperr.CodeValidationFailed, "缺少可还原的原始内容。")
		}
		if _, err := q.UpdateNote(ctx, dbgen.UpdateNoteParams{
			ID: entry.ResourceID, Title: &title, Content: &content,
		}); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

func (s *Service) undoProject(ctx context.Context, q *dbgen.Queries, entry dbgen.ActivityEntry) error {
	switch entry.Action {
	case "created":
		if _, err := q.SoftDeleteProject(ctx, entry.ResourceID); err != nil {
			return apperr.Internal(err)
		}
	case "updated":
		before, err := decodeUndoState(entry.BeforeState)
		if err != nil {
			return err
		}
		status, _ := before["status"].(string)
		if status == "" {
			return apperr.Newf(apperr.CodeValidationFailed, "缺少可还原的原始状态。")
		}
		if _, err := q.UpdateProject(ctx, dbgen.UpdateProjectParams{
			ID: entry.ResourceID, Status: &status,
		}); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}
