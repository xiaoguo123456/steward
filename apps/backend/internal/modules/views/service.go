// Package views 提供 Today、日历、周复盘与搜索这四个只读聚合。
//
// 这些视图不拥有任何数据：收录、排序与指标全部由确定性 SQL 与 Go 计算，
// 客户端不得重排结果，AI 也不能覆盖这里的基础顺序。
package views

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// UserProfile 是 users 模块公开的最小能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
}

// JobEnqueuer 在业务事务内登记异步任务。
type JobEnqueuer interface {
	EnqueueReviewGenerate(ctx context.Context, q *dbgen.Queries, args GenerateArgs) error
}

// Service 是聚合视图的应用服务。
type Service struct {
	db    *database.DB
	users UserProfile
	// chat 与 jobs 只用于复盘叙述这一个可选增强。
	// 它们为空时指标照常可用，只是没有小结。
	chat   ai.ChatProvider
	jobs   JobEnqueuer
	logger *slog.Logger
	// now 可注入，便于测试固定时间下的收录与排序。
	now func() time.Time
}

// New 构造 Service。
func New(db *database.DB, users UserProfile) *Service {
	return &Service{db: db, users: users, logger: slog.Default(), now: time.Now}
}

// WithNarrative 注入生成复盘叙述所需的依赖。
func (s *Service) WithNarrative(chat ai.ChatProvider, jobs JobEnqueuer, logger *slog.Logger) *Service {
	s.chat = chat
	s.jobs = jobs
	if logger != nil {
		s.logger = logger
	}
	return s
}

// Today 是首页聚合结果。
type Today struct {
	Date     time.Time
	Timezone string
	Tasks    []dbgen.ListTodayTasksRow
	Events   []dbgen.Event
}

// GetToday 计算今天的任务与日程。
func (s *Service) GetToday(ctx context.Context, userID string) (Today, error) {
	var out Today
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		loc := timeutil.LoadLocation(tz)
		now := s.now()
		day := timeutil.DayOf(now, loc)

		tasks, err := q.ListTodayTasks(ctx, dbgen.ListTodayTasksParams{
			Tz:       tz,
			Today:    day.Date,
			NowAt:    now,
			DayStart: day.Start,
			DayEnd:   day.End,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		events, err := q.ListEventsInRange(ctx, dbgen.ListEventsInRangeParams{
			FromAt:   day.Start,
			ToAt:     day.End,
			FromDate: day.Date,
			ToDate:   day.Date,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		out = Today{Date: day.Date, Timezone: tz, Tasks: tasks, Events: events}
		return nil
	})
	return out, err
}

// MapToday 把聚合结果映射成契约 DTO。
func MapToday(t Today) httpapi.TodayView {
	tasks := make([]httpapi.TodayTask, 0, len(t.Tasks))
	counts := httpapi.TodayCounts{}

	for _, row := range t.Tasks {
		listName := row.ListName
		item := httpapi.TodayTask{
			Task:      objects.MapTask(todayRowToTask(row)),
			Group:     groupOf(row.GroupRank),
			ListName:  &listName,
			ListColor: row.ListColor,
		}
		tasks = append(tasks, item)

		counts.Total++
		switch row.GroupRank {
		case 0:
			counts.Overdue++
		case 1:
			counts.DueToday++
		case 2:
			counts.ScheduledToday++
		default:
			counts.Manual++
		}
	}

	loc := timeutil.LoadLocation(t.Timezone)
	events := objects.ProjectYearlyEvents(t.Events,
		timeutil.DayOf(t.Date, loc).Start, timeutil.DayOf(t.Date, loc).End, t.Timezone)

	return httpapi.TodayView{
		Date:     openapiDate(t.Date),
		Timezone: t.Timezone,
		Tasks:    tasks,
		Events:   events,
		Counts:   counts,
	}
}

// Calendar 是日历聚合结果。
type Calendar struct {
	From     time.Time
	To       time.Time
	Timezone string
	Tasks    []dbgen.Task
	Events   []dbgen.Event
}

// GetCalendar 按日期范围聚合日历。
func (s *Service) GetCalendar(ctx context.Context, userID string, from, to time.Time, projectID *string) (Calendar, error) {
	if to.Before(from) {
		return Calendar{}, apperr.Validation(apperr.Field("to", "结束日期不能早于开始日期。"))
	}
	// 上界与契约一致，避免一次请求拉取过大范围。
	if to.Sub(from) > 100*24*time.Hour {
		return Calendar{}, apperr.Validation(apperr.Field("to", "查询范围不能超过 100 天。"))
	}

	var out Calendar
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		loc := timeutil.LoadLocation(tz)
		fromDay := timeutil.DayOf(from, loc)
		toDay := timeutil.DayOf(to, loc)

		tasks, err := q.ListTasksInRange(ctx, dbgen.ListTasksInRangeParams{
			ProjectID: projectID,
			FromDate:  fromDay.Date,
			ToDate:    toDay.Date,
			FromAt:    fromDay.Start,
			ToAt:      toDay.End,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		events, err := q.ListEventsInRange(ctx, dbgen.ListEventsInRangeParams{
			ProjectID: projectID,
			FromAt:    fromDay.Start,
			ToAt:      toDay.End,
			FromDate:  fromDay.Date,
			ToDate:    toDay.Date,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		out = Calendar{
			From: fromDay.Date, To: toDay.Date, Timezone: tz,
			Tasks: tasks, Events: events,
		}
		return nil
	})
	return out, err
}

// MapCalendar 按天分组映射成契约 DTO。
func MapCalendar(c Calendar) httpapi.CalendarView {
	loc := timeutil.LoadLocation(c.Timezone)
	fromStart := timeutil.DayOf(c.From, loc).Start
	toEnd := timeutil.DayOf(c.To, loc).End

	// 先把按年重复的重要日投影成具体日期，再按天归组。
	events := objects.ProjectYearlyEvents(c.Events, fromStart, toEnd, c.Timezone)

	byDay := make(map[string]*httpapi.CalendarDay)
	days := make([]*httpapi.CalendarDay, 0)
	for d := c.From; !d.After(c.To); d = d.AddDate(0, 0, 1) {
		day := &httpapi.CalendarDay{
			Date:   openapiDate(d),
			Events: []httpapi.Event{},
			Tasks:  []httpapi.Task{},
		}
		byDay[timeutil.FormatDate(d)] = day
		days = append(days, day)
	}

	for _, e := range events {
		key := ""
		switch {
		case e.StartDate != nil:
			key = timeutil.FormatDate(e.StartDate.Time)
		case e.StartAt != nil:
			key = timeutil.FormatDate(e.StartAt.In(loc))
		}
		if day, ok := byDay[key]; ok {
			day.Events = append(day.Events, e)
		}
	}

	for _, t := range c.Tasks {
		// 一个 Task 可能同时有截止与计划时间，按最能代表“这天要做”的日期归组。
		var key string
		switch {
		case t.ScheduledStartAt != nil:
			key = timeutil.FormatDate(t.ScheduledStartAt.In(loc))
		case t.DueAt != nil:
			key = timeutil.FormatDate(t.DueAt.In(loc))
		case t.DueDate != nil:
			key = timeutil.FormatDate(*t.DueDate)
		}
		if day, ok := byDay[key]; ok {
			day.Tasks = append(day.Tasks, objects.MapTask(t))
		}
	}

	out := make([]httpapi.CalendarDay, 0, len(days))
	for _, d := range days {
		out = append(out, *d)
	}
	return httpapi.CalendarView{
		From:     openapiDate(c.From),
		To:       openapiDate(c.To),
		Timezone: c.Timezone,
		Days:     out,
	}
}

// GetWeeklyReview 计算某一周的确定性复盘指标。
//
// AI 叙述属于可选增强：Provider 不可用时 narrative 为空，
// 指标与来源仍然完整可用。
func (s *Service) GetWeeklyReview(ctx context.Context, userID string, weekOf *time.Time) (httpapi.WeeklyReview, error) {
	var out httpapi.WeeklyReview
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		loc := timeutil.LoadLocation(tz)

		anchor := s.now()
		if weekOf != nil {
			anchor = *weekOf
		}
		prefs, err := q.EnsureUserPreferences(ctx, userID)
		if err != nil {
			return apperr.Internal(err)
		}
		start, end := timeutil.WeekBounds(anchor, loc, prefs.WeekStart)

		periodStart := timeutil.DayOf(start, loc).Start
		periodEnd := timeutil.DayOf(end, loc).End
		prevStart := periodStart.AddDate(0, 0, -7)

		completed, err := q.CountCompletedTasksBetween(ctx, dbgen.CountCompletedTasksBetweenParams{
			FromAt: periodStart, ToAt: periodEnd,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		prevCompleted, err := q.CountCompletedTasksBetween(ctx, dbgen.CountCompletedTasksBetweenParams{
			FromAt: prevStart, ToAt: periodStart,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		created, err := q.CountCreatedTasksBetween(ctx, dbgen.CountCreatedTasksBetweenParams{
			FromAt: periodStart, ToAt: periodEnd,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		notes, err := q.CountNotesCreatedBetween(ctx, dbgen.CountNotesCreatedBetweenParams{
			FromAt: periodStart, ToAt: periodEnd,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		records, err := q.CountRecordsBetween(ctx, dbgen.CountRecordsBetweenParams{
			FromAt: periodStart, ToAt: periodEnd,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		overdue, err := q.CountOverdueTasks(ctx, dbgen.CountOverdueTasksParams{
			Today: timeutil.DayOf(s.now(), loc).Date, NowAt: s.now(),
		})
		if err != nil {
			return apperr.Internal(err)
		}

		completedRows, err := q.ListCompletedTasksBetween(ctx, dbgen.ListCompletedTasksBetweenParams{
			FromAt: periodStart, ToAt: periodEnd, RowLimit: 20,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		delta := float64(completed - prevCompleted)
		sources := make([]httpapi.ReviewSource, 0, len(completedRows))
		for _, row := range completedRows {
			sources = append(sources, httpapi.ReviewSource{
				ResourceType: "task", ResourceId: row.ID, Title: row.Title,
			})
		}

		out = httpapi.WeeklyReview{
			PeriodStart: openapiDate(start),
			PeriodEnd:   openapiDate(end),
			Timezone:    tz,
			Metrics: []httpapi.ReviewMetric{
				{Key: "tasks_completed", Label: "完成任务", Value: float64(completed),
					Unit: strPtr("项"), DeltaVsPrevious: &delta},
				{Key: "tasks_created", Label: "新建任务", Value: float64(created), Unit: strPtr("项")},
				{Key: "tasks_overdue", Label: "当前逾期", Value: float64(overdue), Unit: strPtr("项")},
				{Key: "notes_created", Label: "新增笔记", Value: float64(notes), Unit: strPtr("条")},
				{Key: "records_logged", Label: "打卡记录", Value: float64(records), Unit: strPtr("条")},
			},
			Suggestions: &[]httpapi.ReviewSuggestion{},
			Sources:     sources,
			GeneratedBy: httpapi.CreatedBySystem,
		}

		// 叙述是可选增强：有生成过就带上，没有也不影响上面的指标。
		snapshot, err := q.GetReviewSnapshot(ctx, dbgen.GetReviewSnapshotParams{
			PeriodKind: "weekly", PeriodStart: periodStart,
		})
		if err != nil {
			if !database.IsNoRows(err) {
				return apperr.Internal(err)
			}
			return nil
		}
		applySnapshot(&out, snapshot)
		return nil
	})
	return out, err
}

// applySnapshot 把已生成的叙述与建议合并进复盘结果。
//
// 指标不从快照读：它们每次都由 SQL 重算，快照里的那份只是当时的留档。
func applySnapshot(review *httpapi.WeeklyReview, snapshot dbgen.ReviewSnapshot) {
	if snapshot.Narrative != nil && *snapshot.Narrative != "" {
		review.Narrative = snapshot.Narrative
		review.GeneratedBy = httpapi.CreatedByAi
		review.GeneratedAt = snapshot.GeneratedAt
	}
	var suggestions []httpapi.ReviewSuggestion
	if err := json.Unmarshal(snapshot.Suggestions, &suggestions); err == nil && len(suggestions) > 0 {
		review.Suggestions = &suggestions
	}
}

// Search 在已确认的正式内容中做关键词检索。
//
// 处理中或待确认的 Capture 候选不会出现在结果里：它们还不是用户的正式内容。
func (s *Service) Search(ctx context.Context, userID, query string, types []string, limit int32) ([]httpapi.SearchHit, error) {
	want := make(map[string]bool, len(types))
	for _, t := range types {
		want[t] = true
	}
	include := func(t string) bool { return len(want) == 0 || want[t] }

	var hits []httpapi.SearchHit
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if include("task") {
			rows, err := q.SearchTasks(ctx, dbgen.SearchTasksParams{Query: query, RowLimit: limit})
			if err != nil {
				return apperr.Internal(err)
			}
			for _, r := range rows {
				hits = append(hits, httpapi.SearchHit{
					ResourceType: httpapi.ObjectTypeTask, ResourceId: r.ID,
					Title: r.Title, Score: 1, UpdatedAt: &r.UpdatedAt,
				})
			}
		}
		if include("event") {
			rows, err := q.SearchEvents(ctx, dbgen.SearchEventsParams{Query: query, RowLimit: limit})
			if err != nil {
				return apperr.Internal(err)
			}
			for _, r := range rows {
				hits = append(hits, httpapi.SearchHit{
					ResourceType: httpapi.ObjectTypeEvent, ResourceId: r.ID,
					Title: r.Title, Score: 1, UpdatedAt: &r.UpdatedAt,
				})
			}
		}
		if include("note") {
			rows, err := q.SearchNotes(ctx, dbgen.SearchNotesParams{Query: query, RowLimit: limit})
			if err != nil {
				return apperr.Internal(err)
			}
			for _, r := range rows {
				snippet := buildSnippet(r.Content, query)
				hits = append(hits, httpapi.SearchHit{
					ResourceType: httpapi.ObjectTypeNote, ResourceId: r.ID,
					Title: r.Title, Snippet: &snippet, Score: 1, UpdatedAt: &r.UpdatedAt,
				})
			}
		}
		if include("project") {
			rows, err := q.SearchProjects(ctx, dbgen.SearchProjectsParams{Query: query, RowLimit: limit})
			if err != nil {
				return apperr.Internal(err)
			}
			for _, r := range rows {
				hits = append(hits, httpapi.SearchHit{
					ResourceType: httpapi.ObjectTypeProject, ResourceId: r.ID,
					Title: r.Title, Score: 1, UpdatedAt: &r.UpdatedAt,
				})
			}
		}
		if include("record") {
			rows, err := q.SearchRecords(ctx, dbgen.SearchRecordsParams{Query: query, RowLimit: limit})
			if err != nil {
				return apperr.Internal(err)
			}
			for _, r := range rows {
				hits = append(hits, httpapi.SearchHit{
					ResourceType: httpapi.ObjectTypeRecord, ResourceId: r.ID,
					Title: r.Title, Score: 1, UpdatedAt: &r.UpdatedAt,
				})
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 跨类型统一按更新时间倒序，保证结果稳定可复现。
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].UpdatedAt == nil || hits[j].UpdatedAt == nil {
			return false
		}
		return hits[i].UpdatedAt.After(*hits[j].UpdatedAt)
	})
	if int32(len(hits)) > limit {
		hits = hits[:limit]
	}
	return hits, nil
}

// todayRowToTask 把 Today 查询行还原成通用 Task 行。
func todayRowToTask(row dbgen.ListTodayTasksRow) dbgen.Task {
	return dbgen.Task{
		ID: row.ID, UserID: row.UserID, Title: row.Title, Description: row.Description,
		Status: row.Status, Priority: row.Priority,
		DueDate: row.DueDate, DueAt: row.DueAt, DueTimezone: row.DueTimezone,
		ScheduledStartAt: row.ScheduledStartAt, ScheduledEndAt: row.ScheduledEndAt,
		ScheduledTimezone: row.ScheduledTimezone, EstimatedMinutes: row.EstimatedMinutes,
		FocusDate: row.FocusDate, ListID: row.ListID, ProjectID: row.ProjectID,
		Reminders: row.Reminders, CompletedAt: row.CompletedAt,
		CreatedBy: row.CreatedBy, ProvenanceRefs: row.ProvenanceRefs,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		DeletedAt: row.DeletedAt, Version: row.Version,
	}
}

func groupOf(rank int32) httpapi.TodayGroup {
	switch rank {
	case 0:
		return httpapi.Overdue
	case 1:
		return httpapi.DueToday
	case 2:
		return httpapi.ScheduledToday
	default:
		return httpapi.Manual
	}
}

// buildSnippet 截取命中关键词附近的片段，避免把整篇正文返回给客户端。
func buildSnippet(content, query string) string {
	runes := []rune(content)
	const window = 60
	if len(runes) <= window {
		return content
	}
	return string(runes[:window]) + "…"
}

func strPtr(v string) *string { return &v }
