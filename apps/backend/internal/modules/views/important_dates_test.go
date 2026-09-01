package views

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

func TestNextOccurrenceProjectsYearlyDateToTheFuture(t *testing.T) {
	loc := mustLoad(t, "Asia/Shanghai")
	today := time.Date(2026, 9, 1, 0, 0, 0, 0, loc)
	weddingDate := time.Date(2020, 8, 14, 0, 0, 0, 0, loc)

	next, ok := nextOccurrence(dbgen.Event{
		Title:      "结婚纪念日",
		StartDate:  &weddingDate,
		Recurrence: "yearly",
	}, today, loc)
	if !ok {
		t.Fatal("按年重复的纪念日应当能计算下一次发生日期")
	}
	if got := next.Format("2006-01-02"); got != "2027-08-14" {
		t.Fatalf("今年已过的纪念日应投影到明年，实际 %s", got)
	}
	if got := daysBetween(today, next); got != 347 {
		t.Fatalf("剩余天数应为 347，实际 %d", got)
	}
}

func TestSortImportantDatesKeepsExpiredDatesOutOfUpcoming(t *testing.T) {
	loc := mustLoad(t, "Asia/Shanghai")
	entry := func(id, title, date string, days int) ImportantDateEntry {
		parsed, err := time.ParseInLocation("2006-01-02", date, loc)
		if err != nil {
			t.Fatalf("解析日期 %s 失败：%v", date, err)
		}
		return ImportantDateEntry{
			Event:          dbgen.Event{ID: id, Title: title},
			NextOccurrence: parsed,
			DaysUntil:      days,
		}
	}

	entries := []ImportantDateEntry{
		entry("old", "旧护照到期", "2026-07-01", -62),
		entry("later", "朋友生日", "2026-09-21", 20),
		entry("recent", "房租到期", "2026-08-24", -8),
		entry("first-b", "B 纪念日", "2026-09-14", 13),
		entry("first-a", "A 纪念日", "2026-09-14", 13),
	}

	sortImportantDates(entries)

	want := []string{"first-a", "first-b", "later", "recent", "old"}
	for index, id := range want {
		if entries[index].Event.ID != id {
			t.Fatalf("第 %d 项应为 %s，实际 %s", index, id, entries[index].Event.ID)
		}
	}
	if entries[0].DaysUntil < 0 {
		t.Fatal("“即将到来”的首条数据不得已过期")
	}
}
