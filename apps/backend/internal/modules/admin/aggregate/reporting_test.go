package aggregate

import (
	"testing"
	"time"
)

func TestRecentReportingDaysUsesCalendarTimezone(t *testing.T) {
	cases := []struct{ now, zone, yesterday, today string }{
		{"2026-09-08T16:30:00Z", "Asia/Shanghai", "2026-09-08", "2026-09-09"},
		{"2026-09-08T01:00:00Z", "America/Los_Angeles", "2026-09-06", "2026-09-07"},
		{"2026-03-09T02:00:00Z", "America/New_York", "2026-03-07", "2026-03-08"},
	}
	for _, c := range cases {
		t.Run(c.zone+c.now, func(t *testing.T) {
			now, _ := time.Parse(time.RFC3339, c.now)
			days, err := recentReportingDays(now, c.zone)
			if err != nil {
				t.Fatal(err)
			}
			if days[0].Format(time.DateOnly) != c.yesterday || days[1].Format(time.DateOnly) != c.today {
				t.Fatalf("错误报表日期：%v", days)
			}
		})
	}
}
