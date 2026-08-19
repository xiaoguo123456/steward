package views

import (
	"context"
	"sort"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 行程视图。
//
// 行程不是新的领域类型：它是一个 Project，把 Event、Task 和 Note 组织在一起。
// 这里只做客户端不该自己做的事——按用户时区把日程分到天、算出日期范围。
// 同一次行程跨时区时，「哪天」这个问题只有服务端能给出一致答案。

// Itinerary 是一次行程的聚合结果。
type Itinerary struct {
	Project  dbgen.Project
	Timezone string
	Days     []ItineraryDay
	Tasks    []dbgen.Task
	Notes    []dbgen.Note
	Start    *time.Time
	End      *time.Time
}

// ItineraryDay 是某一天的安排。
type ItineraryDay struct {
	Date   time.Time
	Events []dbgen.Event
}

// GetProjectItinerary 聚合一个项目的行程。
func (s *Service) GetProjectItinerary(ctx context.Context, userID, projectID string) (Itinerary, error) {
	var out Itinerary
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		project, err := q.GetProject(ctx, projectID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个项目")
			}
			return apperr.Internal(err)
		}
		out.Project = project

		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		out.Timezone = tz
		loc := timeutil.LoadLocation(tz)

		events, err := q.ListEvents(ctx, dbgen.ListEventsParams{
			ProjectID: &projectID,
			RowLimit:  200,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out.Days, out.Start, out.End = groupByDay(events, loc)

		tasks, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses:  []string{"todo", "doing", "done"},
			ProjectID: &projectID,
			RowLimit:  200,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out.Tasks = tasks

		notes, err := q.ListNotes(ctx, dbgen.ListNotesParams{
			ProjectID: &projectID,
			RowLimit:  50,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out.Notes = notes
		return nil
	})
	return out, err
}

// groupByDay 把日程按当地日期分组。
//
// 只返回有内容的日期：中间的空当由客户端按起止日期补齐，
// 那样它能自己决定要不要显示「这天没有安排」。
func groupByDay(events []dbgen.Event, loc *time.Location) ([]ItineraryDay, *time.Time, *time.Time) {
	byDay := map[string][]dbgen.Event{}
	dates := map[string]time.Time{}

	for _, event := range events {
		day, ok := localDayOf(event, loc)
		if !ok {
			continue
		}
		key := day.Format("2006-01-02")
		byDay[key] = append(byDay[key], event)
		dates[key] = day
	}
	if len(byDay) == 0 {
		return nil, nil, nil
	}

	keys := make([]string, 0, len(byDay))
	for key := range byDay {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	days := make([]ItineraryDay, 0, len(keys))
	for _, key := range keys {
		items := byDay[key]
		// 当天内按开始时间升序。全天事件没有时刻，排在定时事件前面。
		sort.SliceStable(items, func(i, j int) bool {
			return startOrder(items[i]).Before(startOrder(items[j]))
		})
		days = append(days, ItineraryDay{Date: dates[key], Events: items})
	}

	start := dates[keys[0]]
	end := dates[keys[len(keys)-1]]
	return days, &start, &end
}

// localDayOf 取出一条日程所属的当地日期。
func localDayOf(event dbgen.Event, loc *time.Location) (time.Time, bool) {
	if event.StartAt != nil {
		return timeutil.DayOf(*event.StartAt, loc).Date, true
	}
	if event.StartDate != nil {
		d := *event.StartDate
		return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc), true
	}
	return time.Time{}, false
}

// startOrder 给同一天内的日程一个稳定的排序键。
func startOrder(event dbgen.Event) time.Time {
	if event.StartAt != nil {
		return *event.StartAt
	}
	// 全天事件用零值，排在所有定时事件之前。
	return time.Time{}
}

// MapItinerary 映射成契约 DTO。
func MapItinerary(itinerary Itinerary) httpapi.ProjectItinerary {
	out := httpapi.ProjectItinerary{
		Project: objects.MapProject(objects.ProjectWithProgress{Row: itinerary.Project}),
		Days:    make([]httpapi.ItineraryDay, 0, len(itinerary.Days)),
		Tasks:   make([]httpapi.Task, 0, len(itinerary.Tasks)),
		Notes:   make([]httpapi.Note, 0, len(itinerary.Notes)),
	}
	for _, day := range itinerary.Days {
		events := make([]httpapi.Event, 0, len(day.Events))
		for _, event := range day.Events {
			events = append(events, objects.MapEvent(event))
		}
		out.Days = append(out.Days, httpapi.ItineraryDay{
			Date: openapi_types.Date{Time: day.Date}, Events: events,
		})
	}
	for _, task := range itinerary.Tasks {
		out.Tasks = append(out.Tasks, objects.MapTask(task))
	}
	for _, note := range itinerary.Notes {
		out.Notes = append(out.Notes, objects.MapNote(note))
	}
	if itinerary.Start != nil {
		out.StartDate = &openapi_types.Date{Time: *itinerary.Start}
	}
	if itinerary.End != nil {
		out.EndDate = &openapi_types.Date{Time: *itinerary.End}
	}
	return out
}
