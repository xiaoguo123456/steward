package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/views"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 第一批只读 Capability（后端指南 10.2）。
//
// 每个 Handler 都遵守同一套规则：
//   - user_id 只来自服务端 CapabilityContext，忽略模型自报的任何身份。
//   - 只调用拥有模块的公开 Query，由它们各自开短 RLS 事务；
//     不在这里直接碰别的模块的表。
//   - 只返回回答问题所需的最小字段，不返回正文全文与内部状态。
//   - 返回 SourceRefs，让服务端能校验模型引用的来源是否真的读过。

// TaskQueries 是 objects 模块公开的读取能力。
type TaskQueries interface {
	ListTasks(ctx context.Context, userID string, f objects.TaskFilter) ([]dbgen.Task, error)
	GetTask(ctx context.Context, userID, taskID string) (dbgen.Task, error)
	GetEvent(ctx context.Context, userID, eventID string) (dbgen.Event, error)
	GetNote(ctx context.Context, userID, noteID string) (dbgen.Note, error)
}

// ViewQueries 是 views 模块公开的日期投影、检索与复盘能力。
type ViewQueries interface {
	GetCalendar(ctx context.Context, userID string, from, to time.Time, projectID *string) (views.Calendar, error)
	Search(ctx context.Context, userID, query string, types []string, limit int32) ([]httpapi.SearchHit, error)
	GetWeeklyReview(ctx context.Context, userID string, weekOf *time.Time) (httpapi.WeeklyReview, error)
}

// RecordQueries 是 trackers 模块公开的聚合能力。
type RecordQueries interface {
	AggregateField(ctx context.Context, userID, trackerID, fieldKey string,
		from, to *time.Time) (trackers.FieldAggregate, error)
}

// MemorySearcher 是 memory 模块公开的检索能力。
type MemorySearcher interface {
	Search(ctx context.Context, userID, query string, limit int32) ([]MemoryFact, error)
	// SearchWithStats 额外返回这次检索的可观测信息。
	//
	// 上下文构建走这个版本：能不能检索到记忆决定了长期记忆这个功能有没有用，
	// 而「该不该上向量检索」的判断依据就是它的失败率（见 CLAUDE.md）。
	SearchWithStats(ctx context.Context, userID, query string, limit int32) (
		[]MemoryFact, MemoryRetrievalStats, error)
}

// MemoryRetrievalStats 是一次记忆检索的可观测信息。
//
// 不含查询内容与命中内容：那些是用户资料，不进日志。
type MemoryRetrievalStats struct {
	Keyword   bool
	Hits      int
	Available int
}

// Missed 表示这是一次真正的检索失败：有记忆可用，却一条都没匹配上。
func (s MemoryRetrievalStats) Missed() bool {
	return s.Hits == 0 && s.Available > 0
}

// CapabilityDeps 是登记只读能力所需的全部依赖。
type CapabilityDeps struct {
	Tasks   TaskQueries
	Views   ViewQueries
	Records RecordQueries
	Memory  MemorySearcher
}

// RegisterReadOnly 把第一批只读能力登记进 Registry。
func RegisterReadOnly(reg *ai.Registry, deps CapabilityDeps) {
	reg.Register(ai.Capability{
		Name: "tasks.search",
		Description: "按状态和截止日期查找用户自己的任务，返回标题、状态、优先级和截止日期。" +
			"需要知道用户有哪些任务时用它。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 6 << 10,
		Parameters: object(props{
			"status": enumArray([]string{"todo", "doing", "done"},
				"要查的状态，省略时查未完成的任务。"),
			"due_from": str("起始截止日期，格式 2026-08-19。"),
			"due_to":   str("结束截止日期（含当天），格式 2026-08-19。"),
			"limit":    integer("最多返回多少条，默认 20，上限 50。"),
		}, nil),
		Handler: deps.searchTasks,
	})

	reg.Register(ai.Capability{
		Name: "calendar.read",
		Description: "读取某个日期区间内的日程与重要日，含按年重复的投影结果。" +
			"问到某天或某周有什么安排时用它。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 6 << 10,
		Parameters: object(props{
			"from": str("起始日期，格式 2026-08-19。"),
			"to":   str("结束日期（含当天），格式 2026-08-25。"),
		}, []string{"from", "to"}),
		Handler: deps.readCalendar,
	})

	reg.Register(ai.Capability{
		Name:           "objects.get",
		Description:    "按 ID 读取一条任务、日程或笔记的摘要。已经知道 ID 时用它，不要用它做搜索。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 4 << 10,
		Parameters: object(props{
			"id": str("对象 ID，例如 tsk_xxx、evt_xxx、nte_xxx。"),
		}, []string{"id"}),
		Handler: deps.getObject,
	})

	reg.Register(ai.Capability{
		Name: "records.aggregate",
		Description: "对某个记录项的某个数值字段做统计，返回条数、合计、平均和范围。" +
			"问「这个月花了多少」「平均睡了几小时」这类问题时用它，不要逐条取明细自己算。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 2 << 10,
		Parameters: object(props{
			"tracker_id": str("记录项 ID。不知道时先用 search.hybrid 找。"),
			"field_key":  str("要统计的字段 key，例如 amount。"),
			"from":       str("起始日期，格式 2026-08-01。"),
			"to":         str("结束日期（不含当天），格式 2026-09-01。"),
		}, []string{"tracker_id", "field_key"}),
		Handler: deps.aggregateRecords,
	})

	reg.Register(ai.Capability{
		Name: "search.hybrid",
		Description: "在用户自己的任务、日程、笔记、项目和记录里按关键词搜索。" +
			"不知道具体 ID、只知道大概说法时用它。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 6 << 10,
		Parameters: object(props{
			"query": str("搜索关键词。"),
			"types": enumArray([]string{"task", "event", "note", "project", "record"},
				"限定搜索范围，省略时全部搜。"),
		}, []string{"query"}),
		Handler: deps.hybridSearch,
	})

	reg.Register(ai.Capability{
		Name:           "reviews.read",
		Description:    "读取某一周已经算好的复盘指标：完成数、新增数、逾期数和记录数。",
		Risk:           ai.RiskReadOnly,
		MaxResultBytes: 3 << 10,
		Parameters: object(props{
			"week_of": str("该周内任意一天，格式 2026-08-19。省略时取本周。"),
		}, nil),
		Handler: deps.readReview,
	})

	if deps.Memory != nil {
		reg.Register(ai.Capability{
			Name: "memories.search",
			Description: "查找用户此前确认过的长期偏好，例如常去的健身房、家人生日、饮食禁忌。" +
				"只返回用户确认过的条目。",
			Risk:           ai.RiskReadOnly,
			MaxResultBytes: 2 << 10,
			Parameters: object(props{
				"query": str("要找的偏好关键词。"),
			}, []string{"query"}),
			Handler: deps.searchMemories,
		})
	}
}

// ---- Handler 实现 ----

func (d CapabilityDeps) searchTasks(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	loc := timeutil.LoadLocation(cc.Timezone)
	filter := objects.TaskFilter{
		Statuses:  stringSlice(args["status"]),
		DueFrom:   parseDate(args["due_from"], loc),
		DueBefore: parseDate(args["due_to"], loc),
		Limit:     clampLimit(args["limit"], 20, 50),
	}

	rows, err := d.Tasks.ListTasks(ctx, cc.UserID, filter)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	var out ai.CapabilityResult
	items := make([]map[string]any, 0, len(rows))
	for _, t := range rows {
		item := map[string]any{
			"id": t.ID, "title": t.Title,
			"status": t.Status, "priority": t.Priority,
		}
		if t.DueAt != nil {
			item["due"] = t.DueAt.In(loc).Format("2006-01-02 15:04")
		} else if t.DueDate != nil {
			item["due"] = t.DueDate.Format("2006-01-02")
		}
		items = append(items, item)
		out.SourceRefs = append(out.SourceRefs, "task:"+t.ID)
	}
	out.Content = renderJSON(map[string]any{"tasks": items, "count": len(items)})
	return out, nil
}

func (d CapabilityDeps) readCalendar(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	loc := timeutil.LoadLocation(cc.Timezone)
	from := parseDate(args["from"], loc)
	to := parseDate(args["to"], loc)
	if from == nil || to == nil {
		return ai.CapabilityResult{}, fmt.Errorf("需要 from 与 to 两个日期，格式 2026-08-19")
	}

	calendar, err := d.Views.GetCalendar(ctx, cc.UserID, *from, *to, nil)
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	view := views.MapCalendar(calendar)

	var out ai.CapabilityResult
	days := make([]map[string]any, 0, len(view.Days))
	for _, day := range view.Days {
		entries := make([]map[string]any, 0, len(day.Events)+len(day.Tasks))
		for _, e := range day.Events {
			entry := map[string]any{"id": e.Id, "kind": "event", "title": e.Title}
			if !e.AllDay {
				entry["time"] = e.StartAt.In(loc).Format("15:04")
			}
			entries = append(entries, entry)
			out.SourceRefs = append(out.SourceRefs, "event:"+e.Id)
		}
		for _, t := range day.Tasks {
			entries = append(entries, map[string]any{
				"id": t.Id, "kind": "task", "title": t.Title, "status": t.Status,
			})
			out.SourceRefs = append(out.SourceRefs, "task:"+t.Id)
		}
		if len(entries) == 0 {
			continue
		}
		days = append(days, map[string]any{"date": day.Date.String(), "entries": entries})
	}
	out.Content = renderJSON(map[string]any{"days": days, "day_count": len(days)})
	return out, nil
}

func (d CapabilityDeps) getObject(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	id := strings.TrimSpace(text(args["id"]))
	if id == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 id")
	}
	loc := timeutil.LoadLocation(cc.Timezone)

	var (
		payload map[string]any
		kind    string
	)
	switch {
	case strings.HasPrefix(id, "tsk_"):
		kind = "task"
		t, err := d.Tasks.GetTask(ctx, cc.UserID, id)
		if err != nil {
			return ai.CapabilityResult{}, err
		}
		payload = map[string]any{
			"id": t.ID, "title": t.Title, "status": t.Status,
			"priority": t.Priority, "version": t.Version,
		}
		if t.DueAt != nil {
			payload["due"] = t.DueAt.In(loc).Format("2006-01-02 15:04")
		}
		if t.Description != nil {
			payload["description"] = truncate(*t.Description, 300)
		}
	case strings.HasPrefix(id, "evt_"):
		kind = "event"
		e, err := d.Tasks.GetEvent(ctx, cc.UserID, id)
		if err != nil {
			return ai.CapabilityResult{}, err
		}
		payload = map[string]any{
			"id": e.ID, "title": e.Title, "version": e.Version,
			"start": e.StartAt.In(loc).Format("2006-01-02 15:04"), "all_day": e.AllDay,
		}
	case strings.HasPrefix(id, "nte_"):
		kind = "note"
		n, err := d.Tasks.GetNote(ctx, cc.UserID, id)
		if err != nil {
			return ai.CapabilityResult{}, err
		}
		payload = map[string]any{
			"id": n.ID, "title": n.Title, "version": n.Version,
			"content": truncate(n.Content, 800),
		}
	default:
		return ai.CapabilityResult{}, fmt.Errorf("不支持这种 ID")
	}

	return ai.CapabilityResult{
		Content:    renderJSON(payload),
		SourceRefs: []string{kind + ":" + id},
	}, nil
}

func (d CapabilityDeps) aggregateRecords(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	trackerID := strings.TrimSpace(text(args["tracker_id"]))
	fieldKey := strings.TrimSpace(text(args["field_key"]))
	if trackerID == "" || fieldKey == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 tracker_id 与 field_key")
	}
	loc := timeutil.LoadLocation(cc.Timezone)

	agg, err := d.Records.AggregateField(ctx, cc.UserID, trackerID, fieldKey,
		parseDate(args["from"], loc), parseDate(args["to"], loc))
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	payload := map[string]any{
		"tracker":      agg.TrackerName,
		"field":        fieldKey,
		"record_count": agg.RecordCount,
		"value_count":  agg.ValueCount,
	}
	// value_count 为 0 说明这些记录里没有该字段的数值，此时统计值全是 0，
	// 直接报出去会变成「这个月花了 0 元」这种听着确定其实是假的答案。
	if agg.ValueCount > 0 {
		payload["total"] = agg.Total
		payload["average"] = agg.Average
		payload["min"] = agg.Minimum
		payload["max"] = agg.Maximum
	} else {
		payload["note"] = "这段时间没有该字段的数值记录，不要给出统计结论。"
	}
	return ai.CapabilityResult{
		Content:    renderJSON(payload),
		SourceRefs: []string{"tracker:" + trackerID},
	}, nil
}

func (d CapabilityDeps) hybridSearch(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	query := strings.TrimSpace(text(args["query"]))
	if query == "" {
		return ai.CapabilityResult{}, fmt.Errorf("需要 query")
	}

	hits, err := d.Views.Search(ctx, cc.UserID, query, stringSlice(args["types"]), 20)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	var out ai.CapabilityResult
	items := make([]map[string]any, 0, len(hits))
	for _, h := range hits {
		item := map[string]any{
			"id": h.ResourceId, "type": string(h.ResourceType), "title": h.Title,
		}
		if h.Snippet != nil {
			item["snippet"] = *h.Snippet
		}
		items = append(items, item)
		out.SourceRefs = append(out.SourceRefs,
			string(h.ResourceType)+":"+h.ResourceId)
	}
	out.Content = renderJSON(map[string]any{"hits": items, "count": len(items)})
	return out, nil
}

func (d CapabilityDeps) readReview(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	loc := timeutil.LoadLocation(cc.Timezone)
	review, err := d.Views.GetWeeklyReview(ctx, cc.UserID, parseDate(args["week_of"], loc))
	if err != nil {
		return ai.CapabilityResult{}, err
	}
	metrics := make([]map[string]any, 0, len(review.Metrics))
	for _, m := range review.Metrics {
		item := map[string]any{"key": m.Key, "label": m.Label, "value": m.Value}
		if m.DeltaVsPrevious != nil {
			item["delta_vs_previous"] = *m.DeltaVsPrevious
		}
		metrics = append(metrics, item)
	}
	var out ai.CapabilityResult
	for _, src := range review.Sources {
		out.SourceRefs = append(out.SourceRefs, src.ResourceType+":"+src.ResourceId)
	}
	out.Content = renderJSON(map[string]any{
		"period_start": review.PeriodStart.String(),
		"period_end":   review.PeriodEnd.String(),
		"metrics":      metrics,
	})
	return out, nil
}

func (d CapabilityDeps) searchMemories(ctx context.Context, cc ai.CapabilityContext,
	args map[string]any) (ai.CapabilityResult, error) {

	facts, err := d.Memory.Search(ctx, cc.UserID, strings.TrimSpace(text(args["query"])), 10)
	if err != nil {
		return ai.CapabilityResult{}, err
	}

	var out ai.CapabilityResult
	items := make([]string, 0, len(facts))
	for _, f := range facts {
		items = append(items, f.Text)
		out.SourceRefs = append(out.SourceRefs, "memory:"+f.ID)
	}
	out.Content = renderJSON(map[string]any{"memories": items, "count": len(items)})
	return out, nil
}

// ---- 参数 Schema 与解析辅助 ----

type props = map[string]any

func object(properties props, required []string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func str(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}

func integer(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}

func enumArray(values []string, desc string) map[string]any {
	return map[string]any{
		"type":        "array",
		"description": desc,
		"items":       map[string]any{"type": "string", "enum": values},
	}
}

// text 安全地把模型给的任意值读成字符串。模型输出不可信，类型不对就当空值。
func text(v any) string {
	s, _ := v.(string)
	return s
}

func stringSlice(v any) []string {
	raw, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// parseDate 把 2026-08-19 解析成用户时区的当天零点。
func parseDate(v any, loc *time.Location) *time.Time {
	s := strings.TrimSpace(text(v))
	if s == "" {
		return nil
	}
	t, err := time.ParseInLocation("2006-01-02", s, loc)
	if err != nil {
		return nil
	}
	return &t
}

func clampLimit(v any, def, max int32) int32 {
	f, ok := v.(float64)
	if !ok || f <= 0 {
		return def
	}
	n := int32(f)
	if n > max {
		return max
	}
	return n
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}

// renderJSON 把结果序列化成交回模型的文本。
func renderJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return `{"error":"结果序列化失败"}`
	}
	return string(raw)
}
