package objects

import (
	"strings"
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

func TestValidateTaskStatusTransition(t *testing.T) {
	cases := []struct {
		from, to string
		allowed  bool
	}{
		{"todo", "doing", true},
		{"todo", "done", true},
		{"todo", "cancelled", true},
		{"doing", "todo", true},
		{"doing", "done", true},
		// 已完成或已取消重新打开后统一回到 todo，不能直接跳到 doing。
		{"done", "todo", true},
		{"done", "doing", false},
		{"cancelled", "todo", true},
		{"cancelled", "done", false},
		// 同状态是幂等操作。
		{"done", "done", true},
	}

	for _, tc := range cases {
		err := validateTaskStatusTransition(tc.from, tc.to)
		if tc.allowed && err != nil {
			t.Errorf("%s → %s 应当允许，却报错：%v", tc.from, tc.to, err)
		}
		if !tc.allowed {
			if err == nil {
				t.Errorf("%s → %s 应当被拒绝", tc.from, tc.to)
				continue
			}
			appErr, ok := apperr.As(err)
			if !ok || appErr.Code != apperr.CodeTaskStatusInvalid {
				t.Errorf("%s → %s 应返回 TASK_STATUS_TRANSITION_INVALID，实际 %v", tc.from, tc.to, err)
			}
		}
	}
}

func TestValidateEventTiming(t *testing.T) {
	at := time.Date(2026, 8, 19, 15, 0, 0, 0, time.UTC)
	later := at.Add(time.Hour)
	earlier := at.Add(-time.Hour)
	date := time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC)
	nextDate := date.AddDate(0, 0, 1)
	prevDate := date.AddDate(0, 0, -1)

	cases := []struct {
		name    string
		allDay  bool
		startAt *time.Time
		endAt   *time.Time
		start   *time.Time
		end     *time.Time
		wantErr bool
	}{
		{name: "定时事件有开始时刻", startAt: &at, wantErr: false},
		{name: "定时事件结束晚于开始", startAt: &at, endAt: &later, wantErr: false},
		{name: "定时事件结束早于开始", startAt: &at, endAt: &earlier, wantErr: true},
		{name: "定时事件缺少开始时刻", wantErr: true},
		// 两组字段互斥：定时事件不能带日期字段。
		{name: "定时事件混用日期字段", startAt: &at, start: &date, wantErr: true},
		{name: "全天事件有开始日期", allDay: true, start: &date, wantErr: false},
		{name: "全天事件跨天", allDay: true, start: &date, end: &nextDate, wantErr: false},
		{name: "全天事件结束早于开始", allDay: true, start: &date, end: &prevDate, wantErr: true},
		{name: "全天事件缺少开始日期", allDay: true, wantErr: true},
		{name: "全天事件混用时刻字段", allDay: true, start: &date, startAt: &at, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateEventTiming(tc.allDay, tc.startAt, tc.endAt, tc.start, tc.end)
			if tc.wantErr && err == nil {
				t.Error("期望校验失败")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("期望校验通过，实际报错：%v", err)
			}
		})
	}
}

func TestResolveDueRejectsBothFields(t *testing.T) {
	date := openapiDateOf(2026, time.August, 19)
	at := time.Date(2026, 8, 19, 15, 0, 0, 0, time.UTC)

	_, _, _, err := resolveDue(dueInput{DueDate: &date, DueAt: &at}, "Asia/Shanghai")
	if err == nil {
		t.Fatal("截止日期与截止时刻同时设置时应当报错")
	}
}

func TestResolveDueAlwaysCarriesTimezone(t *testing.T) {
	date := openapiDateOf(2026, time.August, 19)

	// 设置了截止就必须带时区，否则“某日截止”在跨时区时失去确定含义。
	dueDate, dueAt, tz, err := resolveDue(dueInput{DueDate: &date}, "Asia/Shanghai")
	if err != nil {
		t.Fatalf("不应报错：%v", err)
	}
	if dueDate == nil || dueAt != nil {
		t.Error("只应生成 due_date")
	}
	if tz == nil || *tz != "Asia/Shanghai" {
		t.Errorf("期望带上用户时区，实际 %v", tz)
	}

	// 完全没有截止信息时不应凭空生成时区。
	_, _, tz, err = resolveDue(dueInput{}, "Asia/Shanghai")
	if err != nil || tz != nil {
		t.Errorf("没有截止信息时不应返回时区，实际 %v err=%v", tz, err)
	}
}

func TestResolveScheduleRequiresStartBeforeEnd(t *testing.T) {
	start := time.Date(2026, 8, 19, 9, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	bad := start.Add(-time.Hour)

	if _, _, _, err := resolveSchedule(&start, &end, nil, "Asia/Shanghai"); err != nil {
		t.Errorf("正常区间不应报错：%v", err)
	}
	if _, _, _, err := resolveSchedule(&start, &bad, nil, "Asia/Shanghai"); err == nil {
		t.Error("结束早于开始时应当报错")
	}
	if _, _, _, err := resolveSchedule(nil, &end, nil, "Asia/Shanghai"); err == nil {
		t.Error("只有结束时间时应当报错")
	}
}

func TestDeriveNoteTitle(t *testing.T) {
	if got := deriveNoteTitle(nil, "第一行内容\n第二行"); got != "第一行内容" {
		t.Errorf("应取正文首行，实际 %q", got)
	}
	explicit := "用户给的标题"
	if got := deriveNoteTitle(&explicit, "正文"); got != explicit {
		t.Errorf("应优先使用用户标题，实际 %q", got)
	}
	blank := "   "
	if got := deriveNoteTitle(&blank, "正文内容"); got != "正文内容" {
		t.Errorf("空白标题应回退到正文，实际 %q", got)
	}
	// 中文标题按字符截断，不能切出乱码。50 个汉字应被截到 40 个。
	long := deriveNoteTitle(nil, strings.Repeat("一二三四五六七八九十", 5))
	if len([]rune(long)) != 40 {
		t.Errorf("超长标题应截断到 40 个字符，实际 %d", len([]rune(long)))
	}
}

func TestValidateProjectStatusTransition(t *testing.T) {
	if err := validateProjectStatusTransition("active", "completed"); err != nil {
		t.Errorf("active → completed 应当允许：%v", err)
	}
	if err := validateProjectStatusTransition("archived", "active"); err != nil {
		t.Errorf("归档恢复应当允许：%v", err)
	}
}

// openapiDateOf 构造测试用的契约日期值。
func openapiDateOf(year int, month time.Month, day int) openapi_types.Date {
	return openapi_types.Date{Time: time.Date(year, month, day, 0, 0, 0, 0, time.UTC)}
}
