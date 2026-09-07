package assistant

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// Proposal Capability（后端指南 10.3）。
//
// 它们只构造建议，不执行写入：Handler 里没有任何 Command 调用，
// 真正的写入发生在用户点确认之后的那一个事务里。
//
// 每条建议都必须带来源：模型必须先查过东西才能建议改它。
// 这里做的校验是"形状对不对"，不是"该不该做"——后者在确认事务里
// 重新读目标之后再判断。

// RegisterProposals 把 Proposal Capability 登记进 Registry。
func RegisterProposals(reg *ai.Registry, deps CapabilityDeps) {
	registerProposal(reg, ai.Capability{
		Name: "tasks.propose_split",
		Description: "把一个已存在的多步骤任务拆成 2 到 10 条待确认子任务。" +
			"必须先用 objects.get 读取原任务的 id 和 version；这里只生成一条批量建议，确认后才创建子任务并建立 related_to 关系。",
		Risk: ai.RiskProposal, MaxResultBytes: 4 << 10,
		Parameters: object(props{
			"task_id":          str("原任务 ID。"),
			"expected_version": integer("读取原任务时的 version。"),
			"tasks": map[string]any{
				"type": "array", "minItems": 2, "maxItems": 10,
				"items": object(props{
					"title":             str("子任务标题。"),
					"description":       str("可选说明。"),
					"estimated_minutes": integer("可选预计分钟数。"),
				}, []string{"title"}),
			},
			"reason":      str("为什么这样拆分。"),
			"source_refs": enumFreeArray("必须包含刚读取的原任务来源。"),
		}, []string{"task_id", "expected_version", "tasks", "reason", "source_refs"}),
		Handler: deps.proposeTaskSplit,
	})

	registerProposal(reg, ai.Capability{
		Name: "tasks.propose_create",
		Description: "为用户准备一条「新建任务」的待确认建议。" +
			"用户说要做某件事、需要记下来时用它。你不能直接创建任务。",
		Risk:           ai.RiskProposal,
		MaxResultBytes: 1 << 10,
		Parameters: object(props{
			"title":       str("任务标题，用用户自己的说法，不要加修饰。"),
			"description": str("补充说明，没有就不要传。"),
			"due_date":    str("截止日期，格式 2026-08-19。只有日期没有具体时刻时用它。"),
			"due_at":      str("截止时刻，RFC3339 格式。有明确时间点时用它。"),
			"priority":    enumOf([]string{"low", "normal", "high", "urgent"}, "优先级，默认 normal。"),
			"reason":      str("一句话说明你为什么这样建议。"),
			"source_refs": enumFreeArray("你查过的来源，例如 [\"task:tsk_xxx\"]。必须是你真的调用工具读到过的。"),
		}, []string{"title", "reason", "source_refs"}),
		Handler: deps.proposeTaskCreate,
	})

	registerProposal(reg, ai.Capability{
		Name: "tasks.propose_update",
		Description: "为用户准备一条「修改已有任务」的待确认建议，例如改期、改状态、改优先级。" +
			"必须先用 objects.get 或 tasks.search 查到这条任务的 id 和 version。你不能直接修改任务。",
		Risk:           ai.RiskProposal,
		MaxResultBytes: 1 << 10,
		Parameters: object(props{
			"task_id":            str("要修改的任务 ID。"),
			"expected_version":   integer("你读到这条任务时它的 version。"),
			"title":              str("新标题，不改就不要传。"),
			"status":             enumOf([]string{"todo", "doing", "done"}, "新状态，不改就不要传。"),
			"priority":           enumOf([]string{"low", "normal", "high", "urgent"}, "新优先级，不改就不要传。"),
			"due_date":           str("新的截止日期，格式 2026-08-19。只有日期没有具体时刻时用它。"),
			"due_at":             str("新的截止时刻，RFC3339 格式。"),
			"focus_date":         str("新的关注日期，格式 2026-08-19。用户说加入今天时使用当天日期。"),
			"scheduled_start_at": str("新的计划开始时刻，RFC3339 格式。"),
			"scheduled_end_at":   str("新的计划结束时刻，RFC3339 格式。"),
			"reason":             str("一句话说明你为什么这样建议。"),
			"source_refs":        enumFreeArray("你查过的来源。必须是你真的调用工具读到过的。"),
		}, []string{"task_id", "expected_version", "reason", "source_refs"}),
		Handler: deps.proposeTaskUpdate,
	})

	registerProposal(reg, ai.Capability{
		Name: "events.propose_create",
		Description: "为用户准备一条「新建日程」的待确认建议。" +
			"有明确时间点、要出现在日历上的事情用它；只是待办用 tasks.propose_create。",
		Risk:           ai.RiskProposal,
		MaxResultBytes: 1 << 10,
		Parameters: object(props{
			"title":      str("日程标题。"),
			"start_at":   str("开始时刻，RFC3339 格式。定时日程必填。"),
			"end_at":     str("结束时刻，RFC3339 格式。"),
			"start_date": str("开始日期，格式 2026-08-19。全天日程用它。"),
			"all_day":    boolean("是否全天。"),
			"location":   str("地点，没有就不要传。"),
			"event_kind": enumOf([]string{"schedule", "important_date"},
				"schedule 是普通日程，important_date 是生日纪念日这类重要日。"),
			"reason":      str("一句话说明你为什么这样建议。"),
			"source_refs": enumFreeArray("你查过的来源。必须是你真的调用工具读到过的。"),
		}, []string{"title", "reason", "source_refs"}),
		Handler: deps.proposeEventCreate,
	})

	registerProposal(reg, ai.Capability{
		Name: "events.propose_update",
		Description: "为用户准备一条「修改已有重要日」的待确认建议，可更新日期或标记已处理。" +
			"必须先用 objects.get 或 search.hybrid 查到 Event 的 id 和 version。过期不等于已处理，你不能自行推断处理状态。",
		Risk:           ai.RiskProposal,
		MaxResultBytes: 1 << 10,
		Parameters: object(props{
			"event_id":               str("要修改的重要日 Event ID。"),
			"expected_version":       integer("你读到这条 Event 时它的 version。"),
			"start_date":             str("新的公历日期，格式 2026-09-01；不改就不要传。"),
			"important_date_handled": boolean("只有用户明确说已经处理时才传 true；恢复为未处理时传 false。不得根据日期过期推断。"),
			"reason":                 str("一句话说明你为什么这样建议。"),
			"source_refs":            enumFreeArray("你查过的来源。必须是你真的调用工具读到过的。"),
		}, []string{"event_id", "expected_version", "reason", "source_refs"}),
		Handler: deps.proposeEventUpdate,
	})

	if deps.Memory != nil {
		registerProposal(reg, ai.Capability{
			Name: "memories.propose_upsert",
			Description: "为用户准备一条「记住这个偏好」的待确认建议。" +
				"只有用户明确说出的、长期稳定的偏好才用它，例如「我一般晚上七点后运动」。" +
				"一次性的安排、这次的要求、可以从数据算出来的结论都不要记。",
			Risk:           ai.RiskProposal,
			MaxResultBytes: 1 << 10,
			Parameters: object(props{
				"memory_key": str("稳定语义键，例如 routine.exercise_time。同一个偏好每次都要用同一个键。"),
				"memory_type": enumOf([]string{
					"communication_preference", "routine_preference",
					"domain_preference", "personal_context", "constraint",
				}, "偏好类型。"),
				"text": str("给用户看的一句话表述，用他自己的说法。"),
				"sensitivity": enumOf([]string{"normal"},
					"只能是 normal。健康、财务、住址、家庭关系这类信息不要用这个能力记，"+
						"请在回答里请用户自己去设置里添加。"),
				"reason":      str("一句话说明你为什么觉得这是长期偏好。"),
				"source_refs": enumFreeArray("依据来源，通常是用户这条消息。"),
			}, []string{"memory_key", "memory_type", "text", "reason", "source_refs"}),
			Handler: deps.proposeMemoryUpsert,
		})
	}
}

// registerProposal 对模型参数和确认命令采用相同的时间校验。
func registerProposal(reg *ai.Registry, capability ai.Capability) {
	extendProposalSchema(&capability)
	handler := capability.Handler
	capability.Handler = func(ctx context.Context, cc ai.CapabilityContext, args map[string]any) (ai.CapabilityResult, error) {
		if err := validateProposalTimes(args); err != nil {
			return ai.CapabilityResult{}, &ai.ToolInputError{Message: "时间格式无效：日期须为 YYYY-MM-DD，具体时刻须为带时区的 RFC3339。请修正参数后重试。"}
		}
		if capability.Name == "tasks.propose_create" && requiresCalendarEvent(cc) {
			if cc.PendingIntent == "event_create" {
				return ai.CapabilityResult{}, &ai.ToolInputError{Message: "正在补充的是日程，请使用 events.propose_create；不能改成任务。已有时间不要再问。"}
			}
			return ai.CapabilityResult{}, &ai.ClarificationError{Question: "这项日程具体几点开始、几点结束？", Intent: "event_create", MissingField: "start_at"}
		}
		if capability.Name == "events.propose_create" && text(args["start_at"]) == "" && hasDayPeriod(currentUserText(cc)) {
			return ai.CapabilityResult{}, &ai.ClarificationError{Question: "请补充日程具体几点开始、几点结束，不能把指定时段改成全天。", Intent: "event_create", MissingField: "start_at"}
		}
		if capability.Name == "tasks.propose_create" && reminderNeedsTime(cc) && text(args["due_date"]) == "" && text(args["due_at"]) == "" {
			return ai.CapabilityResult{}, &ai.ClarificationError{Question: "你希望具体哪一天、几点提醒？也可以选择只记成无日期任务。", Intent: "task_create", MissingField: "reminder_time"}
		}
		if err := validateTimeEvidence(cc, args); err != nil {
			return ai.CapabilityResult{}, err
		}
		output, err := handler(ctx, cc, args)
		if err != nil {
			return output, err
		}
		for i := range output.Proposals {
			if evidence, ok := args["time_evidence"].(map[string]any); ok {
				for _, value := range evidence {
					if fields, ok := value.(map[string]any); ok && text(fields["suggestion_request"]) != "" {
						output.Proposals[i].Preview.Impact += " 时间为建议，请确认是否合适。"
						break
					}
				}
			}
			if status := text(args["required_status"]); status != "" {
				output.Proposals[i].Command["required_status"] = status
			}
			if evidence, ok := args["time_evidence"]; ok {
				output.Proposals[i].Command["time_evidence"] = evidence
			}
		}
		replacement := text(args["replaces_proposal_id"])
		if replacement != "" {
			valid := false
			for _, pending := range cc.Pending {
				if pending.ID == replacement && len(output.Proposals) == 1 && pending.Type == output.Proposals[0].Type {
					valid = true
					output.Proposals[0].ReplacesProposalID = replacement
					output.Proposals[0].ReplacesProposalVersion = pending.Version
				}
			}
			if !valid {
				return ai.CapabilityResult{}, &ai.ToolInputError{Message: "只能修订当前对话中类型一致的待确认建议。"}
			}
		}
		return output, nil
	}
	reg.Register(capability)
}

func (d CapabilityDeps) proposeTaskSplit(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {
	taskID := strings.TrimSpace(text(args["task_id"]))
	if !strings.HasPrefix(taskID, "tsk_") {
		return ai.CapabilityResult{}, fmt.Errorf("task_id 必须是任务 ID")
	}
	version, ok := args["expected_version"].(float64)
	if !ok {
		return ai.CapabilityResult{}, fmt.Errorf("需要 expected_version")
	}
	current, err := d.Tasks.GetTask(ctx, cc.UserID, taskID)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	if err := d.guardTaskTarget(ctx, cc, args, current); err != nil {
		return ai.CapabilityResult{}, err
	}
	if current.Version != int32(version) {
		return ai.CapabilityResult{}, fmt.Errorf("任务已经变化，请重新读取")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	raw, ok := args["tasks"].([]any)
	if !ok || len(raw) < 2 || len(raw) > 10 {
		return ai.CapabilityResult{}, fmt.Errorf("子任务数量必须是 2 到 10")
	}
	items := make([]map[string]any, 0, len(raw))
	changes := make([]ai.ProposalChange, 0, len(raw))
	for _, value := range raw {
		item, ok := value.(map[string]any)
		if !ok {
			return ai.CapabilityResult{}, fmt.Errorf("子任务格式不正确")
		}
		title := strings.TrimSpace(text(item["title"]))
		if title == "" {
			return ai.CapabilityResult{}, fmt.Errorf("子任务标题不能为空")
		}
		clean := map[string]any{"title": title}
		if description := strings.TrimSpace(text(item["description"])); description != "" {
			clean["description"] = description
		}
		if minutes, ok := item["estimated_minutes"].(float64); ok && minutes > 0 {
			clean["estimated_minutes"] = int(minutes)
		}
		items = append(items, clean)
		changes = append(changes, ai.ProposalChange{Field: "task", Label: "子任务", After: title})
	}
	expected := int(version)
	return ai.CapabilityResult{
		Content:    "已经准备好拆分建议，只有用户确认后才会批量创建。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type: "task_split", TargetType: "task", TargetID: taskID,
			TargetExpectedVersion: &expected,
			Command:               map[string]any{"task_id": taskID, "tasks": items},
			EditableFields:        []string{"selected_tasks"},
			Preview: ai.ProposalPreview{Title: "拆分任务：" + current.Title, Changes: changes,
				Impact: "将创建子任务并与原任务建立关联；原任务不会自动完成。"},
			Reason: strings.TrimSpace(text(args["reason"])), SourceRefs: sources,
		}},
	}, nil
}

func (d CapabilityDeps) proposeTaskCreate(_ context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	title := strings.TrimSpace(text(args["title"]))
	if title == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 title")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	loc := timeutil.LoadLocation(cc.Timezone)

	command := pick(args, "title", "description", "due_date", "due_at", "priority")
	changes := []ai.ProposalChange{{Field: "title", Label: "标题", After: title}}
	if due := describeDue(args, loc); due != "" {
		changes = append(changes, ai.ProposalChange{Field: "due", Label: "截止", After: due})
	}

	return ai.CapabilityResult{
		Content:    "已经为用户准备好这条建议，等他确认。请在回答里说明你建议做什么。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type:    "task_create",
			Command: command,
			Preview: ai.ProposalPreview{
				Title:   "新建任务：" + title,
				Changes: changes,
			},
			Reason:         strings.TrimSpace(text(args["reason"])),
			EditableFields: []string{"title", "description", "due_at", "priority"},
			SourceRefs:     sources,
		}},
	}, nil
}

func (d CapabilityDeps) proposeTaskUpdate(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	if err := guardDeletionAsStatus(cc, args); err != nil {
		return ai.CapabilityResult{}, err
	}

	taskID := strings.TrimSpace(text(args["task_id"]))
	if !strings.HasPrefix(taskID, "tsk_") {
		return ai.CapabilityResult{}, fmt.Errorf("task_id 必须是任务 ID")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	version, ok := args["expected_version"].(float64)
	if !ok {
		return ai.CapabilityResult{}, fmt.Errorf("需要 expected_version：先读这条任务再建议修改")
	}
	expected := int(version)

	// 这里就把目标读出来：模型可能拿着过时的版本号，与其让用户点了确认
	// 才发现建议是基于旧数据，不如现在就拒绝并让它重新查。
	current, err := d.Tasks.GetTask(ctx, cc.UserID, taskID)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	if err := d.guardTaskTarget(ctx, cc, args, current); err != nil {
		return ai.CapabilityResult{}, err
	}
	if int(current.Version) != expected {
		return ai.CapabilityResult{}, fmt.Errorf(
			"这条任务已经变了，请重新读取后再建议")
	}

	command := pick(args, "title", "status", "priority",
		"due_date", "due_at", "focus_date", "scheduled_start_at", "scheduled_end_at")
	if len(command) == 0 {
		return ai.CapabilityResult{}, fmt.Errorf("至少要指定一个要修改的字段")
	}

	loc := timeutil.LoadLocation(cc.Timezone)
	for _, field := range []string{"due_date", "focus_date"} {
		if raw := strings.TrimSpace(text(command[field])); raw != "" && parseDate(raw, loc) == nil {
			return ai.CapabilityResult{}, fmt.Errorf("%s 必须是 YYYY-MM-DD 格式的有效日期", field)
		}
	}
	changes := describeTaskChanges(command, current.Status, current.Priority, current.Title, loc)

	return ai.CapabilityResult{
		Content:    "已经为用户准备好这条建议，等他确认。请在回答里说明你建议改什么。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type:                  "task_update",
			TargetType:            "task",
			TargetID:              taskID,
			TargetExpectedVersion: &expected,
			Command:               command,
			Preview: ai.ProposalPreview{
				Title:   "修改任务：" + current.Title,
				Changes: changes,
			},
			Reason: strings.TrimSpace(text(args["reason"])),
			EditableFields: []string{
				"title", "status", "priority",
				"due_date", "due_at", "focus_date", "scheduled_start_at", "scheduled_end_at",
			},
			SourceRefs: sources,
		}},
	}, nil
}

func (d CapabilityDeps) proposeEventCreate(_ context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	title := strings.TrimSpace(text(args["title"]))
	if title == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 title")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	allDay, _ := args["all_day"].(bool)
	startAt := strings.TrimSpace(text(args["start_at"]))
	startDate := strings.TrimSpace(text(args["start_date"]))
	if !allDay && startAt == "" {
		return ai.CapabilityResult{}, fmt.Errorf("定时日程需要 start_at")
	}
	if allDay && startDate == "" {
		return ai.CapabilityResult{}, fmt.Errorf("全天日程需要 start_date")
	}

	loc := timeutil.LoadLocation(cc.Timezone)
	command := pick(args, "title", "start_at", "end_at",
		"start_date", "all_day", "location", "event_kind")

	when := startDate
	if !allDay {
		if t := parseRFC3339(startAt); t != nil {
			when = t.In(loc).Format("2006-01-02 15:04")
		}
	}
	changes := []ai.ProposalChange{
		{Field: "title", Label: "标题", After: title},
		{Field: "start", Label: "时间", After: when},
	}
	if place := strings.TrimSpace(text(args["location"])); place != "" {
		changes = append(changes, ai.ProposalChange{Field: "location", Label: "地点", After: place})
	}

	return ai.CapabilityResult{
		Content:    "已经为用户准备好这条建议，等他确认。请在回答里说明你建议安排什么。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type:    "event_create",
			Command: command,
			Preview: ai.ProposalPreview{
				Title:   "新建日程：" + title,
				Changes: changes,
			},
			Reason:         strings.TrimSpace(text(args["reason"])),
			EditableFields: []string{"title", "start_at", "end_at", "location"},
			SourceRefs:     sources,
		}},
	}, nil
}

func (d CapabilityDeps) proposeEventUpdate(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	eventID := strings.TrimSpace(text(args["event_id"]))
	if !strings.HasPrefix(eventID, "evt_") {
		return ai.CapabilityResult{}, fmt.Errorf("event_id 必须是 Event ID")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	version, ok := args["expected_version"].(float64)
	if !ok {
		return ai.CapabilityResult{}, fmt.Errorf("需要 expected_version：先读这条重要日再建议修改")
	}
	expected := int(version)

	current, err := d.Tasks.GetEvent(ctx, cc.UserID, eventID)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	if int(current.Version) != expected {
		return ai.CapabilityResult{}, fmt.Errorf("这条重要日已经变了，请重新读取后再建议")
	}
	if current.EventKind != "important_date" {
		return ai.CapabilityResult{}, fmt.Errorf("events.propose_update 当前只支持重要日")
	}

	command := pick(args, "start_date", "important_date_handled")
	if len(command) == 0 {
		return ai.CapabilityResult{}, fmt.Errorf("至少要指定新日期或处理状态")
	}
	loc := timeutil.LoadLocation(cc.Timezone)
	if raw := strings.TrimSpace(text(command["start_date"])); raw != "" && parseDate(raw, loc) == nil {
		return ai.CapabilityResult{}, fmt.Errorf("start_date 必须是 YYYY-MM-DD 格式的有效日期")
	}
	if handled, present := command["important_date_handled"].(bool); present && handled && current.Recurrence != "none" {
		return ai.CapabilityResult{}, fmt.Errorf("每年重复的重要日不能永久标记为已处理")
	}

	changes := describeEventChanges(command, current)
	return ai.CapabilityResult{
		Content:    "已经为用户准备好这条重要日修改建议，等他确认。请明确说明是改日期还是标记处理。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type:                  "event_update",
			TargetType:            "event",
			TargetID:              eventID,
			TargetExpectedVersion: &expected,
			Command:               command,
			Preview: ai.ProposalPreview{
				Title:   "修改重要日：" + current.Title,
				Changes: changes,
			},
			Reason:         strings.TrimSpace(text(args["reason"])),
			EditableFields: []string{"start_date", "important_date_handled"},
			SourceRefs:     sources,
		}},
	}, nil
}

func (d CapabilityDeps) proposeMemoryUpsert(_ context.Context, _ ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	key := strings.TrimSpace(text(args["memory_key"]))
	value := strings.TrimSpace(text(args["text"]))
	if key == "" || value == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 memory_key 与 text")
	}
	if len([]rune(value)) > 200 {
		return ai.CapabilityResult{}, fmt.Errorf("这条偏好太长了，请压缩成一句话")
	}
	// 高敏信息不接受推断。用户说了一句"最近老是头疼"，不等于他愿意让系统
	// 长期记下"有慢性头痛"——那是他自己才有资格下的结论。
	//
	// 这里直接拒绝，而不是把级别降回 normal 再存：降级会把一条真敏感的事实
	// 变成可被检索的普通记忆，比不记更糟。参数枚举里只留 normal 只是给模型的提示，
	// 提示挡不住越权，真正的判断在这一行。
	if s := strings.TrimSpace(text(args["sensitivity"])); s != "" && s != "normal" {
		return ai.CapabilityResult{}, fmt.Errorf(
			"健康、财务、住址、家庭关系这类信息不能由你来记。" +
				"请在回答里告诉用户，如果他愿意长期保留，可以自己在设置里添加")
	}
	sources, err := requireSources(args)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	return ai.CapabilityResult{
		Content: "已经为用户准备好这条记忆建议，等他确认。" +
			"请在回答里说明你打算记住什么，让他知道系统会记下这件事。",
		SourceRefs: sources,
		Proposals: []ai.ProposalDraft{{
			Type:    "memory_upsert",
			Command: pick(args, "memory_key", "memory_type", "text", "sensitivity"),
			Preview: ai.ProposalPreview{
				Title:   "记住：" + value,
				Impact:  "以后回答你的问题时会参考这条偏好。你随时可以在设置里查看或删除。",
				Changes: []ai.ProposalChange{{Field: "text", Label: "内容", After: value}},
			},
			Reason:         strings.TrimSpace(text(args["reason"])),
			EditableFields: []string{"text"},
			SourceRefs:     sources,
		}},
	}, nil
}

// ---- 辅助 ----

// requireSources 强制建议带来源。
//
// 没有来源的建议等于凭空生成：用户看不出它凭什么这么建议，
// 服务端也没法校验模型是不是真的查过。
func requireSources(args map[string]any) ([]string, error) {
	sources := stringSlice(args["source_refs"])
	if len(sources) == 0 {
		return nil, fmt.Errorf("必须给出 source_refs：先查过再建议")
	}
	return sources, nil
}

// pick 只挑出已知字段，模型塞进来的其他键一律丢弃。
func pick(args map[string]any, keys ...string) map[string]any {
	out := make(map[string]any, len(keys))
	for _, key := range keys {
		v, ok := args[key]
		if !ok || v == nil {
			continue
		}
		if s, isStr := v.(string); isStr && strings.TrimSpace(s) == "" {
			continue
		}
		out[key] = v
	}
	return out
}

func describeDue(args map[string]any, loc *time.Location) string {
	if at := parseRFC3339(text(args["due_at"])); at != nil {
		return at.In(loc).Format("2006-01-02 15:04")
	}
	return strings.TrimSpace(text(args["due_date"]))
}

func describeTaskChanges(command map[string]any,
	beforeStatus, beforePriority, beforeTitle string, loc *time.Location) []ai.ProposalChange {

	var changes []ai.ProposalChange
	if v := text(command["title"]); v != "" {
		changes = append(changes, ai.ProposalChange{
			Field: "title", Label: "标题", Before: beforeTitle, After: v,
		})
	}
	if v := text(command["status"]); v != "" {
		changes = append(changes, ai.ProposalChange{
			Field: "status", Label: "状态",
			Before: statusLabel(beforeStatus), After: statusLabel(v),
		})
	}
	if v := text(command["priority"]); v != "" {
		changes = append(changes, ai.ProposalChange{
			Field: "priority", Label: "优先级",
			Before: priorityLabel(beforePriority), After: priorityLabel(v),
		})
	}
	for _, field := range []struct{ key, label string }{
		{"due_date", "截止日期"},
		{"focus_date", "关注日期"},
	} {
		if v := strings.TrimSpace(text(command[field.key])); v != "" {
			changes = append(changes, ai.ProposalChange{
				Field: field.key, Label: field.label, After: v,
			})
		}
	}
	for _, field := range []struct{ key, label string }{
		{"due_at", "截止"},
		{"scheduled_start_at", "计划开始"},
		{"scheduled_end_at", "计划结束"},
	} {
		if t := parseRFC3339(text(command[field.key])); t != nil {
			changes = append(changes, ai.ProposalChange{
				Field: field.key, Label: field.label,
				After: t.In(loc).Format("2006-01-02 15:04"),
			})
		}
	}
	return changes
}

func describeEventChanges(command map[string]any, current dbgen.Event) []ai.ProposalChange {
	var changes []ai.ProposalChange
	if date := strings.TrimSpace(text(command["start_date"])); date != "" {
		before := ""
		if current.StartDate != nil {
			before = timeutil.FormatDate(*current.StartDate)
		}
		changes = append(changes, ai.ProposalChange{
			Field: "start_date", Label: "日期", Before: before, After: date,
		})
		if current.ImportantDateHandledAt != nil {
			changes = append(changes, ai.ProposalChange{
				Field: "important_date_handled", Label: "处理状态", Before: "已处理", After: "未处理",
			})
		}
	}
	if handled, present := command["important_date_handled"].(bool); present {
		before := "未处理"
		if current.ImportantDateHandledAt != nil {
			before = "已处理"
		}
		after := "未处理"
		if handled {
			after = "已处理"
		}
		changes = append(changes, ai.ProposalChange{
			Field: "important_date_handled", Label: "处理状态", Before: before, After: after,
		})
	}
	return changes
}

func statusLabel(s string) string {
	switch s {
	case "todo":
		return "待办"
	case "doing":
		return "进行中"
	case "done":
		return "已完成"
	case "cancelled":
		return "已取消"
	default:
		return s
	}
}

func priorityLabel(p string) string {
	switch p {
	case "low":
		return "低"
	case "normal":
		return "普通"
	case "high":
		return "高"
	case "urgent":
		return "紧急"
	default:
		return p
	}
}

func parseRFC3339(s string) *time.Time {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return nil
	}
	return &t
}

func enumOf(values []string, desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "enum": values}
}

func enumFreeArray(desc string) map[string]any {
	return map[string]any{
		"type":        "array",
		"description": desc,
		"items":       map[string]any{"type": "string"},
	}
}

func boolean(desc string) map[string]any {
	return map[string]any{"type": "boolean", "description": desc}
}
