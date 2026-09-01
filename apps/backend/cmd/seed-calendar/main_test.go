package main

import (
	"testing"
	"time"
)

func TestImportantDateSeedSemantics(t *testing.T) {
	loc, err := time.LoadLocation(seedTimezone)
	if err != nil {
		t.Fatalf("加载时区失败：%v", err)
	}
	date := time.Date(2026, 8, 14, 0, 0, 0, 0, loc)

	want := map[string]struct {
		kind       string
		recurrence string
	}{
		"结婚纪念日": {kind: "anniversary", recurrence: "yearly"},
		"朋友生日":  {kind: "birthday", recurrence: "yearly"},
		"房租到期":  {kind: "expiry", recurrence: "none"},
	}

	seen := make(map[string]bool)
	for _, spec := range calendarEventSpecs() {
		expected, ok := want[spec.title]
		if !ok {
			continue
		}
		seen[spec.title] = true
		params := newSeedEventParams(spec, date, "usr_test")
		if params.ImportantDateKind == nil || *params.ImportantDateKind != expected.kind {
			t.Errorf("%s 的类型应为 %s，实际 %v", spec.title, expected.kind, params.ImportantDateKind)
		}
		if params.Recurrence != expected.recurrence {
			t.Errorf("%s 的重复规则应为 %s，实际 %s", spec.title, expected.recurrence, params.Recurrence)
		}
		if expected.recurrence == "yearly" {
			if params.OriginalMonthDay == nil || *params.OriginalMonthDay != "08-14" {
				t.Errorf("%s 应保留原始月日，实际 %v", spec.title, params.OriginalMonthDay)
			}
		} else if params.OriginalMonthDay != nil {
			t.Errorf("%s 不重复，不应设置原始月日", spec.title)
		}
	}

	for title := range want {
		if !seen[title] {
			t.Errorf("没有找到验收数据 %s", title)
		}
	}
}
