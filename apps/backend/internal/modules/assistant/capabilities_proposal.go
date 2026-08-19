package assistant

import (
	"context"
	"fmt"
	"strings"
	"time"

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
	reg.Register(ai.Capability{
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

	reg.Register(ai.Capability{
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
			"due_at":             str("新的截止时刻，RFC3339 格式。"),
			"scheduled_start_at": str("新的计划开始时刻，RFC3339 格式。"),
			"scheduled_end_at":   str("新的计划结束时刻，RFC3339 格式。"),
			"reason":             str("一句话说明你为什么这样建议。"),
			"source_refs":        enumFreeArray("你查过的来源。必须是你真的调用工具读到过的。"),
		}, []string{"task_id", "expected_version", "reason", "source_refs"}),
		Handler: deps.proposeTaskUpdate,
	})

	reg.Register(ai.Capability{
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
			"event_kind": enumOf([]string{"appointment", "important_date"},
				"appointment 是普通约定，important_date 是生日纪念日这类重要日。"),
			"reason":      str("一句话说明你为什么这样建议。"),
			"source_refs": enumFreeArray("你查过的来源。必须是你真的调用工具读到过的。"),
		}, []string{"title", "reason", "source_refs"}),
		Handler: deps.proposeEventCreate,
	})

	if deps.Memory != nil {
		reg.Register(ai.Capability{
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
	if int(current.Version) != expected {
		return ai.CapabilityResult{}, fmt.Errorf(
			"这条任务已经变了，请重新读取后再建议")
	}

	command := pick(args, "title", "status", "priority",
		"due_at", "scheduled_start_at", "scheduled_end_at")
	if len(command) == 0 {
		return ai.CapabilityResult{}, fmt.Errorf("至少要指定一个要修改的字段")
	}

	loc := timeutil.LoadLocation(cc.Timezone)
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
				"due_at", "scheduled_start_at", "scheduled_end_at",
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
