package assistant

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// Action Proposal。
//
// 模型只产建议，写入全部发生在用户点确认之后的那一个事务里，
// 并且在那个事务里重新读目标、重新跑校验。模型给的理由不能替代这一步。

// ProposalTTL 是建议的有效期。过期后必须重新提问，不能拿旧建议直接执行。
const ProposalTTL = 2 * time.Hour

// ObjectCommands 是 objects 模块公开的事务内写入能力。
type ObjectCommands interface {
	CreateTaskInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateTaskCommand) (dbgen.Task, error)
	CreateEventInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateEventCommand) (dbgen.Event, error)
	UpdateTaskInTx(ctx context.Context, q *dbgen.Queries, userID, taskID string,
		in objects.TaskUpdate, source activity.Source, sourceID *string) (dbgen.Task, string, error)
	UpdateEventInTx(ctx context.Context, q *dbgen.Queries, userID, eventID string,
		in objects.EventUpdate, source activity.Source, sourceID *string) (dbgen.Event, string, error)
	GetTask(ctx context.Context, userID, taskID string) (dbgen.Task, error)
}

// ListResolver 是 lists 模块公开的能力。
type ListResolver interface {
	ResolveListID(ctx context.Context, q *dbgen.Queries, userID string, listID *string) (string, error)
}

// MemoryCommands 是 memory 模块公开的事务内写入能力。
type MemoryCommands interface {
	UpsertInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd MemoryUpsertCommand) (string, error)
}

// MemoryUpsertCommand 是一条确认后要写入的长期记忆。
type MemoryUpsertCommand struct {
	Key         string
	Type        string
	Text        string
	Sensitivity string
	SourceRefs  []string
	ProposalID  string
}

// ProposalService 拥有建议的构造、读取、确认与拒绝。
type ProposalService struct {
	db       *database.DB
	objects  ObjectCommands
	lists    ListResolver
	users    UserProfile
	activity ActivityRecorder
	memory   MemoryCommands
}

// ActivityRecorder 是 activity 模块公开的写入能力。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// NewProposalService 构造 ProposalService。
func NewProposalService(db *database.DB, obj ObjectCommands, lists ListResolver,
	users UserProfile, act ActivityRecorder, mem MemoryCommands) *ProposalService {
	return &ProposalService{
		db: db, objects: obj, lists: lists,
		users: users, activity: act, memory: mem,
	}
}

// ---- 落库 ----

// SaveDraft 把模型产出的建议落库，返回落库后的建议 ID。
//
// 校验不通过的草稿直接丢弃并返回空 ID：宁可这一轮没有建议，
// 也不给用户一个点了会报错或者执行出意外结果的按钮。
func (s *ProposalService) SaveDraft(ctx context.Context, q *dbgen.Queries,
	userID, threadID, turnID string, draft ai.ProposalDraft) (string, error) {

	if !isKnownProposalType(draft.Type) {
		return "", nil
	}
	if strings.TrimSpace(draft.Preview.Title) == "" {
		return "", nil
	}
	// 无来源的建议不下发：用户没法判断它凭什么这么建议。
	if len(draft.SourceRefs) == 0 {
		return "", nil
	}

	command, err := json.Marshal(draft.Command)
	if err != nil {
		return "", apperr.Internal(err)
	}
	preview, err := json.Marshal(mapPreviewToContract(draft.Preview, draft.EditableFields))
	if err != nil {
		return "", apperr.Internal(err)
	}
	sources, err := json.Marshal(draft.SourceRefs)
	if err != nil {
		return "", apperr.Internal(err)
	}

	proposal, err := q.CreateProposal(ctx, dbgen.CreateProposalParams{
		ID:                    idgen.New(idgen.PrefixProposal),
		UserID:                userID,
		ThreadID:              &threadID,
		TurnID:                &turnID,
		ProposalType:          draft.Type,
		TargetType:            nilIfEmpty(draft.TargetType),
		TargetID:              nilIfEmpty(draft.TargetID),
		TargetExpectedVersion: int32Ptr(draft.TargetExpectedVersion),
		Command:               command,
		Preview:               preview,
		Reason:                draft.Reason,
		SourceRefs:            sources,
		ExpiresAt:             time.Now().Add(ProposalTTL),
	})
	if err != nil {
		return "", apperr.Internal(err)
	}

	// 同一目标上的旧建议作废：留着两条互相矛盾的建议只会让用户误点。
	if draft.TargetID != "" {
		if err := q.SupersedeProposalsForTarget(ctx, dbgen.SupersedeProposalsForTargetParams{
			TargetType: nilIfEmpty(draft.TargetType),
			TargetID:   nilIfEmpty(draft.TargetID),
			KeepID:     proposal.ID,
		}); err != nil {
			return "", apperr.Internal(err)
		}
	}
	return proposal.ID, nil
}

// ---- 读取 ----

// List 读取建议列表。
func (s *ProposalService) List(ctx context.Context, userID string, statuses []string,
	cursorTime *time.Time, cursorID *string, limit int32) ([]dbgen.ActionProposal, error) {

	if len(statuses) == 0 {
		statuses = []string{"pending"}
	}
	var out []dbgen.ActionProposal
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// 顺手把到期的建议转成 expired，避免列表里出现"待确认但点了会失败"的项。
		if err := q.ExpireStaleProposals(ctx); err != nil {
			return apperr.Internal(err)
		}
		rows, err := q.ListProposals(ctx, dbgen.ListProposalsParams{
			Statuses:        statuses,
			CursorCreatedAt: cursorTime,
			CursorID:        cursorID,
			RowLimit:        limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// Get 读取单条建议。
func (s *ProposalService) Get(ctx context.Context, userID, proposalID string) (dbgen.ActionProposal, error) {
	var out dbgen.ActionProposal
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetProposal(ctx, proposalID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条建议")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// Reject 拒绝建议。不修改任何业务数据。
func (s *ProposalService) Reject(ctx context.Context, userID, proposalID string) (dbgen.ActionProposal, error) {
	var out dbgen.ActionProposal
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetProposal(ctx, proposalID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条建议")
			}
			return apperr.Internal(err)
		}
		if current.Status != "pending" {
			return apperr.New(apperr.CodeAIProposalResolved)
		}
		row, err := q.MarkProposalResolved(ctx, dbgen.MarkProposalResolvedParams{
			Status: "rejected", ID: proposalID,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// ---- 确认执行 ----

// ConfirmResult 是确认执行的结果。
type ConfirmResult struct {
	Proposal        dbgen.ActionProposal
	ActivityBatchID string
	Affected        []httpapi.AffectedResource
}

// Confirm 确认并执行建议。
//
// 整个过程在一个事务里：锁建议 → 校验版本与过期 → 重新读目标 →
// 重新跑领域校验 → 映射成类型化 Domain Command → 执行 → 写 Activity。
// 任一步失败整体回滚。
func (s *ProposalService) Confirm(ctx context.Context, userID, proposalID string,
	body httpapi.ConfirmProposalRequest) (ConfirmResult, error) {

	var out ConfirmResult
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.LockProposal(ctx, proposalID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条建议")
			}
			return apperr.Internal(err)
		}
		if current.Status != "pending" {
			return apperr.New(apperr.CodeAIProposalResolved)
		}
		if int32(body.ProposalVersion) != current.Version {
			return apperr.New(apperr.CodeVersionConflict)
		}
		if time.Now().After(current.ExpiresAt) {
			if _, err := q.MarkProposalResolved(ctx, dbgen.MarkProposalResolvedParams{
				Status: "expired", ID: proposalID,
			}); err != nil {
				return apperr.Internal(err)
			}
			return apperr.New(apperr.CodeAIProposalExpired)
		}

		command, err := s.applyEdits(current, body.Edits)
		if err != nil {
			return err
		}

		result, err := s.execute(ctx, q, userID, current, command, body.TargetExpectedVersion)
		if err != nil {
			return err
		}

		var batchID *string
		if result.ActivityBatchID != "" {
			batchID = &result.ActivityBatchID
		}
		executed, err := q.MarkProposalExecuted(ctx, dbgen.MarkProposalExecutedParams{
			ExecutedBatchID: batchID, ID: proposalID,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		result.Proposal = executed
		out = result
		return nil
	})
	return out, err
}

// applyEdits 把用户在确认页的修改合并进 command。
//
// 只接受 editable_fields 里声明过的字段：模型不能通过 edits 换掉命令类型
// 或目标 ID，用户也不能借此改成一条服务端没有校验过的命令。
func (s *ProposalService) applyEdits(proposal dbgen.ActionProposal,
	edits *map[string]any) (map[string]any, error) {

	var command map[string]any
	if err := json.Unmarshal(proposal.Command, &command); err != nil {
		return nil, apperr.Internal(err)
	}
	if edits == nil || len(*edits) == 0 {
		return command, nil
	}

	allowed := map[string]bool{}
	for _, f := range editableFieldsOf(proposal.Preview) {
		allowed[f] = true
	}

	for key, value := range *edits {
		if !allowed[key] {
			return nil, apperr.Newf(apperr.CodeAIProposalEditNotAllowed,
				"「%s」不支持在确认页修改。", key)
		}
		command[key] = value
	}
	return command, nil
}

// execute 按类型分派到对应的 Domain Command Mapper。
func (s *ProposalService) execute(ctx context.Context, q *dbgen.Queries, userID string,
	proposal dbgen.ActionProposal, command map[string]any,
	targetVersion *int) (ConfirmResult, error) {

	switch proposal.ProposalType {
	case "task_create":
		return s.executeTaskCreate(ctx, q, userID, proposal, command)
	case "task_update":
		return s.executeTaskUpdate(ctx, q, userID, proposal, command, targetVersion)
	case "event_create":
		return s.executeEventCreate(ctx, q, userID, proposal, command)
	case "event_update":
		return s.executeEventUpdate(ctx, q, userID, proposal, command, targetVersion)
	case "memory_upsert":
		return s.executeMemoryUpsert(ctx, q, userID, proposal, command)
	default:
		return ConfirmResult{}, apperr.Validation(
			apperr.Field("proposal_type", "不支持这种建议类型。"))
	}
}

func (s *ProposalService) executeTaskCreate(ctx context.Context, q *dbgen.Queries,
	userID string, proposal dbgen.ActionProposal, command map[string]any) (ConfirmResult, error) {

	title := strings.TrimSpace(text(command["title"]))
	if title == "" {
		return ConfirmResult{}, apperr.Validation(apperr.Field("title", "任务标题不能为空。"))
	}

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return ConfirmResult{}, err
	}
	loc := timeutil.LoadLocation(tz)

	listID, err := s.lists.ResolveListID(ctx, q, userID, nilIfEmpty(text(command["list_id"])))
	if err != nil {
		return ConfirmResult{}, err
	}

	cmd := objects.CreateTaskCommand{
		Title:       title,
		Priority:    priorityOr(text(command["priority"]), "normal"),
		DueDate:     parseDate(command["due_date"], loc),
		DueAt:       parseTimestamp(command["due_at"]),
		DueTimezone: tz,
		ListID:      listID,
		CreatedBy:   "ai",
		Provenance:  provenanceOf(proposal),
	}
	if desc := strings.TrimSpace(text(command["description"])); desc != "" {
		cmd.Description = &desc
	}

	task, err := s.objects.CreateTaskInTx(ctx, q, userID, cmd)
	if err != nil {
		return ConfirmResult{}, err
	}

	batchID, err := s.activity.Record(ctx, q, userID, activity.SourceProposal, &proposal.ID,
		[]activity.EntryInput{{
			Action: "created", ResourceType: "task", ResourceID: task.ID,
			Title: task.Title, Summary: "根据建议新建了任务",
		}})
	if err != nil {
		return ConfirmResult{}, err
	}
	return ConfirmResult{
		ActivityBatchID: batchID,
		Affected: []httpapi.AffectedResource{
			{Type: httpapi.AffectedResourceTypeTask, Id: &task.ID},
		},
	}, nil
}

func (s *ProposalService) executeTaskUpdate(ctx context.Context, q *dbgen.Queries,
	userID string, proposal dbgen.ActionProposal, command map[string]any,
	targetVersion *int) (ConfirmResult, error) {

	if proposal.TargetID == nil || *proposal.TargetID == "" {
		return ConfirmResult{}, apperr.Validation(apperr.Field("target_id", "缺少要修改的任务。"))
	}

	// 期望版本：请求里给了就用请求的，否则用生成建议时记下的那个。
	expected := proposal.TargetExpectedVersion
	if targetVersion != nil {
		v := int32(*targetVersion)
		expected = &v
	}

	// 目标在建议生成后被改动过时，原样执行会覆盖用户后来的修改。
	current, err := q.GetTask(ctx, *proposal.TargetID)
	if err != nil {
		if database.IsNoRows(err) {
			return ConfirmResult{}, apperr.NotFound("任务")
		}
		return ConfirmResult{}, apperr.Internal(err)
	}
	if expected != nil && current.Version != *expected {
		if _, err := q.MarkProposalResolved(ctx, dbgen.MarkProposalResolvedParams{
			Status: "stale", ID: proposal.ID,
		}); err != nil {
			return ConfirmResult{}, apperr.Internal(err)
		}
		return ConfirmResult{}, apperr.New(apperr.CodeAIProposalStale)
	}

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return ConfirmResult{}, err
	}
	body, err := buildTaskUpdateBody(command, timeutil.LoadLocation(tz), tz)
	if err != nil {
		return ConfirmResult{}, err
	}

	task, batchID, err := s.objects.UpdateTaskInTx(ctx, q, userID, *proposal.TargetID,
		objects.TaskUpdate{Body: body, ExpectedVersion: expected},
		activity.SourceProposal, &proposal.ID)
	if err != nil {
		return ConfirmResult{}, err
	}
	return ConfirmResult{
		ActivityBatchID: batchID,
		Affected: []httpapi.AffectedResource{
			{Type: httpapi.AffectedResourceTypeTask, Id: &task.ID},
		},
	}, nil
}

func (s *ProposalService) executeEventCreate(ctx context.Context, q *dbgen.Queries,
	userID string, proposal dbgen.ActionProposal, command map[string]any) (ConfirmResult, error) {

	title := strings.TrimSpace(text(command["title"]))
	if title == "" {
		return ConfirmResult{}, apperr.Validation(apperr.Field("title", "日程标题不能为空。"))
	}

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return ConfirmResult{}, err
	}
	loc := timeutil.LoadLocation(tz)

	cmd := objects.CreateEventCommand{
		Title:      title,
		EventKind:  eventKindOr(text(command["event_kind"]), "schedule"),
		AllDay:     boolOf(command["all_day"]),
		StartAt:    parseTimestamp(command["start_at"]),
		EndAt:      parseTimestamp(command["end_at"]),
		StartDate:  parseDate(command["start_date"], loc),
		EndDate:    parseDate(command["end_date"], loc),
		Timezone:   tz,
		Recurrence: "none",
		CreatedBy:  "ai",
		Provenance: provenanceOf(proposal),
	}
	if place := strings.TrimSpace(text(command["location"])); place != "" {
		cmd.Location = &place
	}

	event, err := s.objects.CreateEventInTx(ctx, q, userID, cmd)
	if err != nil {
		return ConfirmResult{}, err
	}

	batchID, err := s.activity.Record(ctx, q, userID, activity.SourceProposal, &proposal.ID,
		[]activity.EntryInput{{
			Action: "created", ResourceType: "event", ResourceID: event.ID,
			Title: event.Title, Summary: "根据建议新建了日程",
		}})
	if err != nil {
		return ConfirmResult{}, err
	}
	return ConfirmResult{
		ActivityBatchID: batchID,
		Affected: []httpapi.AffectedResource{
			{Type: httpapi.AffectedResourceTypeEvent, Id: &event.ID},
		},
	}, nil
}

func (s *ProposalService) executeEventUpdate(ctx context.Context, q *dbgen.Queries,
	userID string, proposal dbgen.ActionProposal, command map[string]any,
	targetVersion *int) (ConfirmResult, error) {

	if proposal.TargetID == nil || *proposal.TargetID == "" {
		return ConfirmResult{}, apperr.Validation(apperr.Field("target_id", "缺少要修改的重要日。"))
	}
	expected := proposal.TargetExpectedVersion
	if targetVersion != nil {
		v := int32(*targetVersion)
		expected = &v
	}

	current, err := q.GetEvent(ctx, *proposal.TargetID)
	if err != nil {
		if database.IsNoRows(err) {
			return ConfirmResult{}, apperr.NotFound("重要日")
		}
		return ConfirmResult{}, apperr.Internal(err)
	}
	if expected != nil && current.Version != *expected {
		if _, err := q.MarkProposalResolved(ctx, dbgen.MarkProposalResolvedParams{
			Status: "stale", ID: proposal.ID,
		}); err != nil {
			return ConfirmResult{}, apperr.Internal(err)
		}
		return ConfirmResult{}, apperr.New(apperr.CodeAIProposalStale)
	}

	loc := timeutil.LoadLocation(current.Timezone)
	body, err := buildEventUpdateBody(command, loc)
	if err != nil {
		return ConfirmResult{}, err
	}
	event, batchID, err := s.objects.UpdateEventInTx(ctx, q, userID, *proposal.TargetID,
		objects.EventUpdate{Body: body, ExpectedVersion: expected},
		activity.SourceProposal, &proposal.ID)
	if err != nil {
		return ConfirmResult{}, err
	}
	return ConfirmResult{
		ActivityBatchID: batchID,
		Affected: []httpapi.AffectedResource{
			{Type: httpapi.AffectedResourceTypeEvent, Id: &event.ID},
			{Type: httpapi.AffectedResourceTypeToday},
			{Type: httpapi.AffectedResourceTypeCalendar},
		},
	}, nil
}

func (s *ProposalService) executeMemoryUpsert(ctx context.Context, q *dbgen.Queries,
	userID string, proposal dbgen.ActionProposal, command map[string]any) (ConfirmResult, error) {

	if s.memory == nil {
		return ConfirmResult{}, apperr.Validation(
			apperr.Field("proposal_type", "记忆功能尚未启用。"))
	}
	key := strings.TrimSpace(text(command["memory_key"]))
	value := strings.TrimSpace(text(command["text"]))
	if key == "" || value == "" {
		return ConfirmResult{}, apperr.Validation(apperr.Field("text", "记忆内容不完整。"))
	}

	var sources []string
	_ = json.Unmarshal(proposal.SourceRefs, &sources)

	memoryID, err := s.memory.UpsertInTx(ctx, q, userID, MemoryUpsertCommand{
		Key: key,
		// 类型与敏感级别的收敛由 memory 模块负责，这里只透传模型给的原值。
		Type:        text(command["memory_type"]),
		Text:        value,
		Sensitivity: text(command["sensitivity"]),
		SourceRefs:  sources,
		ProposalID:  proposal.ID,
	})
	if err != nil {
		return ConfirmResult{}, err
	}
	return ConfirmResult{
		Affected: []httpapi.AffectedResource{
			{Type: httpapi.AffectedResourceTypeMemory, Id: &memoryID},
		},
	}, nil
}

// ---- 辅助 ----

func isKnownProposalType(t string) bool {
	switch t {
	case "task_create", "task_update", "event_create", "event_update", "memory_upsert":
		return true
	default:
		return false
	}
}

// mapPreviewToContract 把中立预览转成契约结构，并带上可编辑字段声明。
func mapPreviewToContract(p ai.ProposalPreview, editable []string) map[string]any {
	changes := make([]map[string]any, 0, len(p.Changes))
	for _, c := range p.Changes {
		item := map[string]any{"field": c.Field, "label": c.Label}
		if c.Before != "" {
			item["before"] = c.Before
		}
		if c.After != "" {
			item["after"] = c.After
		}
		changes = append(changes, item)
	}
	out := map[string]any{"title": p.Title, "changes": changes}
	if p.Impact != "" {
		out["impact"] = p.Impact
	}
	if len(editable) > 0 {
		out["editable_fields"] = editable
	}
	return out
}

// editableFieldsOf 从预览 JSON 里取回可编辑字段声明。
func editableFieldsOf(preview []byte) []string {
	var parsed struct {
		EditableFields []string `json:"editable_fields"`
	}
	if err := json.Unmarshal(preview, &parsed); err != nil {
		return nil
	}
	return parsed.EditableFields
}

// provenanceOf 记录内容来自哪条建议，让用户之后还能查到来源。
func provenanceOf(proposal dbgen.ActionProposal) []objects.ProvenanceInput {
	return []objects.ProvenanceInput{{
		SourceType: "assistant_proposal",
		SourceID:   proposal.ID,
	}}
}

// buildTaskUpdateBody 把 command 映射成类型化的更新请求。
//
// 只认识固定几个字段：command 不是任意 JSON Patch，
// 模型塞进来的未知键一律忽略，不会变成对数据库的自由写入。
func buildTaskUpdateBody(command map[string]any, loc *time.Location,
	timezone string) (httpapi.UpdateTaskRequest, error) {
	var body httpapi.UpdateTaskRequest

	if title := strings.TrimSpace(text(command["title"])); title != "" {
		body.Title = &title
	}
	if status := strings.TrimSpace(text(command["status"])); status != "" {
		s := httpapi.TaskStatus(status)
		body.Status = &s
	}
	if priority := strings.TrimSpace(text(command["priority"])); priority != "" {
		p := httpapi.TaskPriority(priority)
		body.Priority = &p
	}
	if raw := strings.TrimSpace(text(command["due_date"])); raw != "" {
		date := parseDate(raw, loc)
		if date == nil {
			return body, apperr.Validation(apperr.Field("due_date", "截止日期格式不正确。"))
		}
		body.DueDate = &openapi_types.Date{Time: *date}
		body.DueTimezone = &timezone
	}
	if due := parseTimestamp(command["due_at"]); due != nil {
		body.DueAt = due
		body.DueTimezone = &timezone
	}
	if raw := strings.TrimSpace(text(command["focus_date"])); raw != "" {
		date := parseDate(raw, loc)
		if date == nil {
			return body, apperr.Validation(apperr.Field("focus_date", "关注日期格式不正确。"))
		}
		body.FocusDate = &openapi_types.Date{Time: *date}
	}
	if start := parseTimestamp(command["scheduled_start_at"]); start != nil {
		body.ScheduledStartAt = start
	}
	if end := parseTimestamp(command["scheduled_end_at"]); end != nil {
		body.ScheduledEndAt = end
	}
	return body, nil
}

func buildEventUpdateBody(command map[string]any, loc *time.Location) (httpapi.UpdateEventRequest, error) {
	var body httpapi.UpdateEventRequest
	if raw := strings.TrimSpace(text(command["start_date"])); raw != "" {
		date := parseDate(raw, loc)
		if date == nil {
			return body, apperr.Validation(apperr.Field("start_date", "重要日日期格式不正确。"))
		}
		body.StartDate = &openapi_types.Date{Time: *date}
	}
	if raw, present := command["important_date_handled"]; present {
		handled, ok := raw.(bool)
		if !ok {
			return body, apperr.Validation(apperr.Field(
				"important_date_handled", "处理状态必须是布尔值。"))
		}
		body.ImportantDateHandled = &handled
	}
	if body.StartDate == nil && body.ImportantDateHandled == nil {
		return body, apperr.Validation(apperr.Field("command", "重要日建议没有可执行的修改。"))
	}
	return body, nil
}

func priorityOr(v, def string) string {
	switch v {
	case "low", "normal", "high", "urgent":
		return v
	default:
		return def
	}
}

func eventKindOr(v, def string) string {
	switch v {
	case "schedule", "important_date":
		return v
	default:
		return def
	}
}

// parseTimestamp 解析 RFC3339 时刻。
func parseTimestamp(v any) *time.Time {
	s := strings.TrimSpace(text(v))
	if s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	return &t
}

func boolOf(v any) bool {
	b, _ := v.(bool)
	return b
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func int32Ptr(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}
