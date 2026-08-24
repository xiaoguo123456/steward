package assistant

import (
	"testing"
	"time"
)

func TestConversationDayBoundsUsesUserTimezone(t *testing.T) {
	now := time.Date(2026, time.August, 24, 9, 30, 0, 0, time.UTC)
	start, end := conversationDayBounds(now, "Asia/Shanghai")

	wantStart := time.Date(2026, time.August, 23, 16, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.August, 24, 16, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) || !end.Equal(wantEnd) {
		t.Fatalf("自然日边界错误：得到 %s～%s，期望 %s～%s", start, end, wantStart, wantEnd)
	}
}

func TestConversationDayBoundsHandlesDaylightSaving(t *testing.T) {
	now := time.Date(2026, time.March, 8, 16, 0, 0, 0, time.UTC)
	start, end := conversationDayBounds(now, "America/New_York")

	if got := end.Sub(start); got != 23*time.Hour {
		t.Fatalf("夏令时切换日应为 23 小时，得到 %s", got)
	}
	if start.In(start.Location()).Day() != 8 || end.In(end.Location()).Day() != 9 {
		t.Fatalf("边界没有覆盖当地 3 月 8 日：%s～%s", start, end)
	}
}
