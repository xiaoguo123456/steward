package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/assets"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

func extendProposalSchema(capability *ai.Capability) {
	var schema struct {
		Properties map[string]any `json:"properties"`
	}
	if err := json.Unmarshal(assets.ProposalGuardsSchemaV1, &schema); err != nil {
		panic("建议前置条件 Schema 无效")
	}
	properties := capability.Parameters["properties"].(props)
	for name, value := range schema.Properties {
		if name == "required_status" && capability.Name != "tasks.propose_update" && capability.Name != "tasks.propose_split" {
			continue
		}
		if name == "time_evidence" {
			fields := []string{}
			for _, field := range []string{"due_date", "due_at", "focus_date", "scheduled_start_at", "scheduled_end_at", "start_at", "end_at", "start_date"} {
				if _, ok := properties[field]; ok {
					fields = append(fields, field)
				}
			}
			if len(fields) == 0 {
				continue
			}
			value.(map[string]any)["propertyNames"] = map[string]any{"enum": fields}
		}
		properties[name] = value
	}
}

func currentUserText(cc ai.CapabilityContext) string {
	if len(cc.UserTexts) == 0 {
		return ""
	}
	return cc.UserTexts[len(cc.UserTexts)-1]
}

func quotedUserFragment(cc ai.CapabilityContext, fragment string) bool {
	if fragment == "" {
		return false
	}
	for _, text := range cc.UserTexts {
		if strings.Contains(text, fragment) {
			return true
		}
	}
	return false
}

func validateTimeEvidence(cc ai.CapabilityContext, args map[string]any) error {
	evidence, _ := args["time_evidence"].(map[string]any)
	for _, field := range []string{"due_date", "due_at", "focus_date", "scheduled_start_at", "scheduled_end_at", "start_at", "end_at", "start_date"} {
		if text(args[field]) == "" {
			continue
		}
		source, _ := evidence[field].(map[string]any)
		if request := text(source["suggestion_request"]); request != "" {
			if !quotedUserFragment(cc, request) || !suggestedTimeRequest.MatchString(request) {
				return &ai.ToolInputError{Message: "只有用户明确请求推荐时段，才能提交建议时间；普通安排请求仍需补齐具体时间。"}
			}
			if field != "scheduled_start_at" && field != "scheduled_end_at" && field != "start_at" && field != "end_at" {
				return &ai.ToolInputError{Message: "推荐时段不能冒充用户指定的截止日期或提醒时间。"}
			}
			value, err := time.Parse(time.RFC3339, text(args[field]))
			if err != nil || value.Before(cc.Now) || value.After(cc.Now.AddDate(0, 0, 30)) {
				return &ai.ToolInputError{Message: "请推荐未来 30 天内的有效时段，超出范围应先澄清。"}
			}
			continue
		}
		dateText := text(source["date_text"])
		if !quotedUserFragment(cc, dateText) {
			return &ai.ToolInputError{Message: field + " 缺少来自用户原话的 time_evidence.date_text；不能自行选择日期，请补充来源或向用户澄清。"}
		}
		anchor := cc.Now
		for i := len(cc.UserSources) - 1; i >= 0; i-- {
			if strings.Contains(cc.UserSources[i].Text, dateText) {
				anchor = cc.UserSources[i].CreatedAt
				// 来源元数据由服务端补齐，模型输入 Schema 不允许自报这两个字段。
				if cc.UserSources[i].ID != "" {
					source["date_source_ref"] = "message:" + cc.UserSources[i].ID
				}
				source["date_anchor"] = anchor.Format(time.RFC3339)
				break
			}
		}
		date, err := timeutil.ResolveDateExpression(dateText, anchor, timeutil.LoadLocation(cc.Timezone))
		if err != nil {
			return &ai.ClarificationError{Question: "日期还不能唯一确定，请告诉我具体年月日；我不会顺延不存在的日期。"}
		}
		if strings.HasSuffix(field, "_date") {
			args[field] = date.Format("2006-01-02")
			continue
		}
		clock, period := text(source["time_text"]), text(source["period_text"])
		if !quotedUserFragment(cc, clock) || (period != "" && !quotedUserFragment(cc, period)) {
			return &ai.ClarificationError{Question: "具体时间还不明确，请补充几点开始、几点结束。"}
		}
		// 用户常把两个端点写在同一句里；按字段取端点并继承该句唯一时段。
		originalClock := clock
		clock = strings.TrimSpace(strings.TrimPrefix(clock, dateText))
		clock = strings.TrimSuffix(clock, "整")
		if field == "due_at" {
			clock = strings.TrimSuffix(clock, "前")
		}
		pieces := clockRange.Split(clock, -1)
		if len(pieces) == 2 && (field == "start_at" || field == "end_at" || field == "scheduled_start_at" || field == "scheduled_end_at") {
			clock = strings.TrimSpace(pieces[0])
			if field == "end_at" || field == "scheduled_end_at" {
				clock = strings.TrimSpace(pieces[1])
			}
		}
		if period == "" {
			period = periodFromUser(cc, originalClock, dateText)
		}
		value, err := timeutil.ResolveClockExpression(clock, period, date)
		if err != nil {
			return &ai.ClarificationError{Question: "请补充具体时刻，并说明是上午还是下午。"}
		}
		args[field] = value.Format(time.RFC3339)
	}
	return nil
}

// guardTaskTarget 用真实 Query 验证唯一性与前提，模型自报的目标和条件不足以授权。
func (d CapabilityDeps) guardTaskTarget(ctx context.Context, cc ai.CapabilityContext, args map[string]any, current dbgen.Task) error {
	if cc.SelectedVersion > 0 && cc.EntryResourceID == current.ID && cc.SelectedVersion != int(current.Version) {
		return &ai.ClarificationError{Question: "你选择的任务已经变化，请重新查看并选择当前任务。"}
	}
	if cc.EntryResourceID != current.ID && !strings.Contains(currentUserText(cc), current.ID) {
		rows, err := d.Tasks.ListTasks(ctx, cc.UserID, objects.TaskFilter{Query: &current.Title, Statuses: []string{"todo", "doing", "done"}, Limit: 50})
		if err != nil {
			return err
		}
		matches := []dbgen.Task{}
		for _, row := range rows {
			if row.Title == current.Title {
				matches = append(matches, row)
			}
		}
		if len(matches) > 1 {
			return taskChoiceQuestion(cc, matches)
		}
	}
	userText := currentUserText(cc)
	if preserveDeadline.MatchString(userText) && (text(args["due_date"]) != "" || text(args["due_at"]) != "") {
		return &ai.ClarificationError{Question: "截止时间同时被要求修改和保持不变，请确认以哪项要求为准。"}
	}
	conditional := strings.Contains(userText, "如果") || strings.Contains(userText, "只有") || strings.Contains(userText, "前提") || strings.Contains(userText, "否则")
	required := text(args["required_status"])
	if conditional {
		// 首版只接受可验证的任务状态前提，不能把天气等未知条件改写成状态条件。
		clause := regexp.MustCompile(`[，,]|就|才|则`).Split(userText, 2)[0]
		if !supportedStatusCondition.MatchString(clause) {
			return &ai.ClarificationError{Question: "这个条件目前不能可靠验证，请先明确任务状态前提，或去掉条件后重新说明。"}
		}
		if strings.Contains(clause, "未完成") || strings.Contains(clause, "没完成") {
			return &ai.ClarificationError{Question: "未完成可能包括未开始或进行中，请明确以哪一种任务状态为前提。"}
		}
		if strings.Contains(clause, "完成") || strings.Contains(clause, "做完") {
			required = "done"
			args["required_status"] = required
		}
	}
	if conditional && required == "" {
		return &ai.ClarificationError{Question: "请明确任务需要处于什么状态时才能修改；其他复杂条件需要先确认。"}
	}
	if required != "" && current.Status != required {
		return &ai.ClarificationError{Question: "任务当前状态不满足你要求的前提，这次没有准备修改建议。"}
	}
	return nil
}

func taskStatusLabel(status string) string {
	switch status {
	case "todo":
		return "未开始"
	case "doing":
		return "进行中"
	case "done":
		return "已完成"
	}
	return "其他状态"
}

var supportedStatusCondition = regexp.MustCompile(`^(如果|若|只有).*(已经完成|已完成|完成|做完|进行中|未开始)[ ]*$`)

var preserveDeadline = regexp.MustCompile(`((截止|到期)(时间|日期)?[^，。；]{0,12}(不变|别动|保持原样)|(保持|保留)[^，。；]{0,8}(截止|到期))`)

var suggestedTimeRequest = regexp.MustCompile(`((推荐|建议|挑选|选个|选一个).{0,10}(时间|时段)|给出首选|帮我选时间)`)

func taskChoiceQuestion(cc ai.CapabilityContext, matches []dbgen.Task) *ai.ClarificationError {

	choices := []ai.ClarificationChoice{}
	for i, row := range matches {
		if i == 10 {
			break
		}
		due := "无截止日期"
		if row.DueDate != nil {
			due = row.DueDate.Format("2006-01-02")
		}
		if row.DueAt != nil {
			due = row.DueAt.In(timeutil.LoadLocation(cc.Timezone)).Format("2006-01-02 15:04")
		}
		label := fmt.Sprintf("%d. %s · %s · %s", i+1, row.Title, due, taskStatusLabel(row.Status))
		choices = append(choices, ai.ClarificationChoice{ID: idgen.New(idgen.PrefixMessage), Label: label, ResourceType: "task", ResourceID: row.ID, Version: int(row.Version)})
	}
	return &ai.ClarificationError{Question: "有多条同名任务，请选择要处理的那一条。", Intent: "task_update", MissingField: "target", Choices: choices}
}

// 搜索已经发现同名写入目标时立即澄清，不再让模型重复查询或追问已给出的日期。
func ambiguousTaskSearch(cc ai.CapabilityContext, rows []dbgen.Task) *ai.ClarificationError {
	if cc.EntryResourceID != "" || !taskWriteRequest.MatchString(currentUserText(cc)) {
		return nil
	}
	counts := map[string][]dbgen.Task{}
	for _, row := range rows {
		if row.Title != "" && strings.Contains(currentUserText(cc), row.Title) {
			counts[row.Title] = append(counts[row.Title], row)
		}
	}
	for _, row := range rows {
		if matches := counts[row.Title]; len(matches) > 1 {
			return taskChoiceQuestion(cc, matches)
		}
	}
	return nil
}

var taskWriteRequest = regexp.MustCompile(`((把|将|帮我|请).*(改|延|推迟|提前|拆|完成|移)|改到|改成)`)

var clockRange = regexp.MustCompile(`[到至\-–—]`)

func periodFromUser(cc ai.CapabilityContext, clock, dateText string) string {
	for _, fragment := range []string{clock, dateText} {
		for i := len(cc.UserTexts) - 1; i >= 0; i-- {
			if !strings.Contains(cc.UserTexts[i], fragment) {
				continue
			}
			period := ""
			for _, candidate := range []string{"凌晨", "早上", "上午", "中午", "下午", "晚上"} {
				if strings.Contains(cc.UserTexts[i], candidate) {
					if period != "" {
						return ""
					}
					period = candidate
				}
			}
			if period != "" {
				return period
			}
		}
	}
	return ""
}

func reminderNeedsTime(cc ai.CapabilityContext) bool {
	value := currentUserText(cc)
	for _, word := range []string{"不要提醒", "不用提醒", "无需提醒", "不设提醒", "无日期", "不设截止", "先不提醒"} {
		if strings.Contains(value, word) {
			return false
		}
	}
	if cc.PendingReminder {
		return true
	}
	for _, word := range []string{"提醒我", "叫我", "通知我", "到点喊我"} {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

func requiresCalendarEvent(cc ai.CapabilityContext) bool {
	value := currentUserText(cc)
	if strings.Contains(value, "任务") || strings.Contains(value, "待办") || strings.Contains(value, "清单") {
		return false
	}
	if cc.PendingIntent == "event_create" {
		return true
	}
	if !strings.Contains(value, "安排") && !strings.Contains(value, "开会") && !strings.Contains(value, "约") {
		return false
	}
	for _, word := range []string{"会议", "开会", "读书会", "评审", "面试", "聚会"} {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

func hasDayPeriod(value string) bool {
	for _, word := range []string{"凌晨", "早上", "上午", "中午", "下午", "晚上"} {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

// 删除与任务状态不是同一种领域操作，不能用“已完成”代替不支持的删除。
func guardDeletionAsStatus(cc ai.CapabilityContext, args map[string]any) error {
	value := currentUserText(cc)
	if text(args["status"]) != "" && containsAny(value, "删除", "删掉", "删了", "删光", "清空") &&
		!containsAny(value, "标记", "标为", "标成", "设为", "改为", "改成", "完成", "做完", "进行中", "未开始", "重新打开") {
		return &ai.ClarificationError{Intent: "other", MissingField: "operation", Question: "目前不能通过助理删除已保存的内容，也不会用标记完成代替删除。请到对应列表或详情页手动删除。"}
	}
	return nil
}
