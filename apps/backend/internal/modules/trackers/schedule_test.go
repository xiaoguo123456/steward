package trackers

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

func TestScheduleDueToday(t *testing.T) {
	loc := timeutil.LoadLocation("Asia/Shanghai")
	// 2026-08-25 是周二。
	now := time.Date(2026, 8, 25, 9, 0, 0, 0, loc)
	weekdays := []int{2, 4}

	cases := []struct {
		name          string
		schedule      *httpapi.TrackerSchedule
		builtin       bool
		status        string
		recordedToday bool
		want          bool
	}{
		{name: "不定期不进入今日", status: "active", want: false},
		{name: "每天且未记录", schedule: &httpapi.TrackerSchedule{Frequency: httpapi.Daily}, status: "active", want: true},
		{name: "每天但已经记录", schedule: &httpapi.TrackerSchedule{Frequency: httpapi.Daily}, status: "active", recordedToday: true, want: false},
		{name: "每周命中星期", schedule: &httpapi.TrackerSchedule{Frequency: httpapi.Weekly, Weekdays: &weekdays}, status: "active", want: true},
		{name: "内置项不进入今日", schedule: &httpapi.TrackerSchedule{Frequency: httpapi.Daily}, builtin: true, status: "active", want: false},
		{name: "归档项不进入今日", schedule: &httpapi.TrackerSchedule{Frequency: httpapi.Daily}, status: "archived", want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scheduleDueToday(tc.schedule, tc.builtin, tc.status, tc.recordedToday, now, loc)
			if got != tc.want {
				t.Fatalf("期望 %v，实际 %v", tc.want, got)
			}
		})
	}
}

func TestValidateWeeklySchedule(t *testing.T) {
	if err := validateSchedule(&httpapi.TrackerSchedule{Frequency: httpapi.Weekly}); err == nil {
		t.Fatal("每周频率没有选择星期时应拒绝")
	}
	invalid := []int{0, 8}
	if err := validateSchedule(&httpapi.TrackerSchedule{
		Frequency: httpapi.Weekly, Weekdays: &invalid,
	}); err == nil {
		t.Fatal("非法星期应拒绝")
	}
}
