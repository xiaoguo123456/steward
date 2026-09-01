package objects

import (
	"strings"
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
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

func TestResolveImportantDateHandledAtRequiresExplicitCommand(t *testing.T) {
	now := time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC)

	set, handledAt, err := resolveImportantDateHandledAt(importantDateHandlingInput{
		Kind: "important_date", Recurrence: "none", Now: now,
	})
	if err != nil || set || handledAt != nil {
		t.Fatalf("没有显式命令时不得根据日期写入处理状态：set=%v value=%v err=%v", set, handledAt, err)
	}

	handled := true
	set, handledAt, err = resolveImportantDateHandledAt(importantDateHandlingInput{
		Kind: "important_date", Recurrence: "none", Explicit: &handled, Now: now,
	})
	if err != nil || !set || handledAt == nil || !handledAt.Equal(now) {
		t.Fatalf("显式处理一次性重要日应写入服务端时间：set=%v value=%v err=%v", set, handledAt, err)
	}
}

func TestResolveImportantDateHandledAtClearsOnRenewal(t *testing.T) {
	current := time.Date(2026, 8, 24, 3, 0, 0, 0, time.UTC)
	set, handledAt, err := resolveImportantDateHandledAt(importantDateHandlingInput{
		Current: &current, Kind: "important_date", Recurrence: "none", Reset: true,
	})
	if err != nil || !set || handledAt != nil {
		t.Fatalf("更新日期时应恢复为未处理：set=%v value=%v err=%v", set, handledAt, err)
	}
}

func TestResolveImportantDateHandledAtRejectsYearlyEvent(t *testing.T) {
	handled := true
	_, _, err := resolveImportantDateHandledAt(importantDateHandlingInput{
		Kind: "important_date", Recurrence: "yearly", Explicit: &handled, Now: time.Now(),
	})
	if err == nil {
		t.Fatal("年度重复重要日不能永久标记为已处理")
	}
}

func TestImportantDateIdentityChangedIgnoresRepeatedFullPayload(t *testing.T) {
	currentDate := time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC)
	sameDate := openapi_types.Date{Time: currentDate}
	current := dbgen.Event{
		EventKind: "important_date", Recurrence: "none", StartDate: &currentDate,
	}
	if importantDateIdentityChanged(current, &sameDate, false, "important_date", "none") {
		t.Fatal("完整请求携带相同日期、类型和重复规则时不应恢复为未处理")
	}

	newDate := openapi_types.Date{Time: currentDate.AddDate(1, 0, 0)}
	if !importantDateIdentityChanged(current, &newDate, false, "important_date", "none") {
		t.Fatal("真正更新日期时应恢复为未处理")
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

func TestResolveProjectStatus(t *testing.T) {
	completed := "completed"
	paused := "paused"

	cases := []struct {
		name string
		in   projectStatusChange
		want string
		// wantErr 为空表示应当成功。
		wantErr apperr.Code
	}{
		{
			name: "标记完成时有未完成任务要先确认",
			in: projectStatusChange{
				From: "active", Requested: "completed", OpenTasks: 2,
			},
			wantErr: apperr.CodeProjectHasOpenTasks,
		},
		{
			name: "确认过之后完成并自动归档",
			in: projectStatusChange{
				From: "active", Requested: "completed", OpenTasks: 2, Force: true,
			},
			want: "archived",
		},
		{
			name: "没有未完成任务时直接完成并归档",
			in: projectStatusChange{
				From: "active", Requested: "completed", OpenTasks: 0,
			},
			want: "archived",
		},
		{
			name: "历史已完成项目恢复后重新打开",
			in: projectStatusChange{
				From: "archived", Requested: "active", BeforeArchived: &completed,
			},
			want: "active",
		},
		{
			name: "归档前是暂停就恢复成暂停",
			in: projectStatusChange{
				From: "archived", Requested: "active", BeforeArchived: &paused,
			},
			want: "paused",
		},
		{
			name: "恢复历史已完成项目不触发未完成任务确认",
			in: projectStatusChange{
				From: "archived", Requested: "active",
				BeforeArchived: &completed, OpenTasks: 3,
			},
			want: "active",
		},
		{
			name: "没有记录归档前状态时按客户端请求恢复",
			in:   projectStatusChange{From: "archived", Requested: "active"},
			want: "active",
		},
		{
			name:    "非法转换直接拒绝",
			in:      projectStatusChange{From: "completed", Requested: "paused"},
			wantErr: apperr.CodeTaskStatusInvalid,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveProjectStatus(tc.in)
			if tc.wantErr != "" {
				appErr, ok := apperr.As(err)
				if !ok || appErr.Code != tc.wantErr {
					t.Fatalf("期望错误 %s，实际 %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("不该出错：%v", err)
			}
			if got != tc.want {
				t.Fatalf("期望写入 %s，实际 %s", tc.want, got)
			}
		})
	}
}

// 客户端传来的时区必须在写入前拒绝。
//
// 这条不是理论风险：`timeutil.LoadLocation` 遇到坏值会静默回退到默认时区，
// 所以坏值一旦存下来，提醒与 Today 收录都在按一个用户没选过的时区算，
// 全程不报错。伦敦用户存进一个坏值，提醒就会按上海时间响。
func TestResolveDueRejectsInvalidTimezone(t *testing.T) {
	date := openapi_types.Date{Time: time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)}
	bad := "这不是时区"
	_, _, _, err := resolveDue(dueInput{DueDate: &date, Timezone: &bad}, "Asia/Shanghai")
	if err == nil {
		t.Fatal("非法 due_timezone 应当被拒绝")
	}
	appErr, ok := apperr.As(err)
	if !ok || len(appErr.Fields) == 0 || appErr.Fields[0].Field != "due_timezone" {
		t.Fatalf("错误应指向 due_timezone 字段，实际：%+v", err)
	}
}

// 用户资料里的时区同样不可信：它是上一次登录时客户端写进去的。
func TestResolveDueRejectsInvalidUserTimezone(t *testing.T) {
	date := openapi_types.Date{Time: time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)}
	if _, _, _, err := resolveDue(dueInput{DueDate: &date}, "评测用户"); err == nil {
		t.Fatal("用户资料里的非法时区也应当被拒绝")
	}
}

func TestResolveScheduleRejectsInvalidTimezone(t *testing.T) {
	start := time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	bad := "Not/A_Zone"
	if _, _, _, err := resolveSchedule(&start, &end, &bad, "Asia/Shanghai"); err == nil {
		t.Fatal("非法 scheduled_timezone 应当被拒绝")
	}
}

// 合法时区不能被误伤——包括不在中国的那些，
// 夏令时切换正是必须存真实时区名而不是偏移量的原因。
func TestResolveDueAcceptsRealZones(t *testing.T) {
	date := openapi_types.Date{Time: time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)}
	for _, zone := range []string{"Europe/London", "America/New_York", "America/Los_Angeles", "UTC"} {
		z := zone
		if _, _, _, err := resolveDue(dueInput{DueDate: &date, Timezone: &z}, "Asia/Shanghai"); err != nil {
			t.Errorf("%s 应当通过，实际：%v", zone, err)
		}
	}
}
