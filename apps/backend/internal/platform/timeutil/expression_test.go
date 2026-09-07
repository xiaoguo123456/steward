package timeutil

import (
	"testing"
	"time"
)

func TestResolveExplicitTimeWithoutGuessing(t *testing.T) {
	loc := LoadLocation("Asia/Shanghai")
	now := time.Date(2026, 9, 7, 10, 0, 0, 0, loc)
	for _, tc := range []struct{ input, want string }{
		{"明天", "2026-09-08"}, {"下周一", "2026-09-14"}, {"2028年二月二十九日", "2028-02-29"},
		{"9月31日", ""}, {"2月30号", ""}, {"过几天", ""}, {"下个月", ""}, {"2月28日", ""},
	} {
		got, err := ResolveDateExpression(tc.input, now, loc)
		if tc.want == "" {
			if err == nil {
				t.Errorf("%s 不应被擅自解析", tc.input)
			}
			continue
		}
		if err != nil || got.Format("2006-01-02") != tc.want {
			t.Errorf("%s 解析不符：%v %v", tc.input, got, err)
		}
	}
	for _, tc := range []struct{ input, period, want string }{
		{"三点", "下午", "15:00"}, {"四点", "下午", "16:00"}, {"9:30", "", "09:30"}, {"十点半", "上午", "10:30"},
		{"下午", "", ""}, {"三点", "", ""}, {"25:00", "", ""}, {"15:61", "", ""},
	} {
		got, err := ResolveClockExpression(tc.input, tc.period, now)
		if tc.want == "" {
			if err == nil {
				t.Errorf("%s 不应补齐小时", tc.input)
			}
			continue
		}
		if err != nil || got.Format("15:04") != tc.want {
			t.Errorf("%s 解析不符：%v %v", tc.input, got, err)
		}
	}
}
