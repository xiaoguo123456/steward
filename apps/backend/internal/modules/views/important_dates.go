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
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 重要日视图。
//
// 重要日不是新的领域类型：它是 event_kind=important_date 的全天 Event。
// 这里只做两件客户端不该自己做的事——把按年重复的定义投影到下一次发生的
// 具体日期，以及按那个日期排序。
//
// 投影必须在服务端：它依赖用户时区和闰年规则，客户端各算各的会出现
// 同一条重要日在不同设备上显示不同天数。

// ImportantDateEntry 是一条重要日及其投影结果。
type ImportantDateEntry struct {
	Event          dbgen.Event
	NextOccurrence time.Time
	DaysUntil      int
}

// GetImportantDates 读取重要日并计算下一次发生日期。
func (s *Service) GetImportantDates(ctx context.Context, userID string, limit int32) ([]ImportantDateEntry, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	var (
		out []ImportantDateEntry
		tz  string
	)
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		zone, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		tz = zone
		loc := timeutil.LoadLocation(zone)
		today := timeutil.DayOf(s.now(), loc).Date

		kind := "important_date"
		rows, err := q.ListEvents(ctx, dbgen.ListEventsParams{
			EventKind: &kind,
			RowLimit:  limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		for _, row := range rows {
			next, ok := nextOccurrence(row, today, loc)
			if !ok {
				continue
			}
			out = append(out, ImportantDateEntry{
				Event:          row,
				NextOccurrence: next,
				DaysUntil:      daysBetween(today, next),
			})
		}

		// 按下一次发生日期升序。同一天的按标题稳定排序，
		// 否则两次请求的顺序可能不一样。
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].NextOccurrence.Equal(out[j].NextOccurrence) {
				return out[i].Event.Title < out[j].Event.Title
			}
			return out[i].NextOccurrence.Before(out[j].NextOccurrence)
		})
		return nil
	})
	return out, tz, err
}

// nextOccurrence 算出这条重要日的下一次发生日期。
//
// 按年重复：投影到今年，已经过了就投影到明年。
// 不重复：就是它自己的日期，已经过去也照实返回负数天数，
// 让用户看到"护照上个月已经到期了"而不是让它凭空消失。
func nextOccurrence(row dbgen.Event, today time.Time, loc *time.Location) (time.Time, bool) {
	source := row.StartDate
	if source == nil {
		// 重要日按契约是全天事件；万一有定时的，用它的当地日期兜底。
		if row.StartAt == nil {
			return time.Time{}, false
		}
		day := timeutil.DayOf(*row.StartAt, loc).Date
		source = &day
	}
	local := time.Date(source.Year(), source.Month(), source.Day(), 0, 0, 0, 0, loc)

	if row.Recurrence != "yearly" {
		return local, true
	}
	next := timeutil.ProjectYearly(local.Month(), local.Day(), today.Year(), loc)
	if next.Before(today) {
		next = timeutil.ProjectYearly(local.Month(), local.Day(), today.Year()+1, loc)
	}
	return next, true
}

// daysBetween 按当地日历天计算间隔，不受时区偏移与夏令时影响。
func daysBetween(from, to time.Time) int {
	fromDay := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	toDay := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	return int(toDay.Sub(fromDay).Hours() / 24)
}

// MapImportantDates 映射成契约 DTO。
func MapImportantDates(entries []ImportantDateEntry) []httpapi.ImportantDateEntry {
	out := make([]httpapi.ImportantDateEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, httpapi.ImportantDateEntry{
			Event:              objects.MapEvent(entry.Event),
			NextOccurrenceDate: openapi_types.Date{Time: entry.NextOccurrence},
			DaysUntil:          entry.DaysUntil,
		})
	}
	return out
}
