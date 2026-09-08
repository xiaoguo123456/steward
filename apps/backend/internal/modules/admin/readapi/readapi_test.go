package readapi

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
)

// 只读接口里那些纯函数的测试。
//
// 这几条守的是「怎么把不确定表达出去」：分母为 0 的比率、缺价的金额、
// 翻页的游标。都是不连数据库就能测的确定性逻辑。

// 分母为 0 时返回空，**不是 0**。
//
// 没有样本和转化率为零是两回事：后者会让人以为这一步把所有人都挡住了，
// 从而去优化一个根本不存在的问题。
func TestRatioReturnsNilForZeroDenominator(t *testing.T) {
	if got := ratio(0, 0); got != nil {
		t.Errorf("分母为 0 应当返回空，实际 %v", *got)
	}
	if got := ratio(5, 0); got != nil {
		t.Errorf("分母为 0 时即使分子不为 0 也该返回空，实际 %v", *got)
	}
	got := ratio(3, 4)
	if got == nil || *got != 0.75 {
		t.Errorf("3/4 应当是 0.75，实际 %v", got)
	}
	// 分子为 0 但分母不为 0 时，0 是真实结论，要返回 0 而不是空。
	zero := ratio(0, 10)
	if zero == nil || *zero != 0 {
		t.Errorf("0/10 是真实的 0，不该返回空")
	}
}

// 缺价时金额为空，界面显示「价格缺失」而不是 0。
func TestMoneyLeavesAmountEmptyWhenUnknown(t *testing.T) {
	got := money("", "pricing_missing")
	if got.Amount != nil {
		t.Errorf("缺价时金额应当为空，实际 %v", *got.Amount)
	}
	if got.Status != adminapi.CostStatus("pricing_missing") {
		t.Errorf("状态应当原样带出，实际 %v", got.Status)
	}
	if got.Currency != adminapi.CNY {
		t.Error("币种应当是 CNY")
	}
}

// **partial 的金额要保留。** 一次调用输入算出来了、输出缺价，
// 算出来那部分的钱是真实花掉的，丢掉它账目会凭空少一块。
func TestMoneyKeepsPartialAmount(t *testing.T) {
	got := money("0.01081000", "partial")
	if got.Amount == nil {
		t.Fatal("partial 时已算出的金额必须保留")
	}
	if *got.Amount != "0.01081000" {
		t.Errorf("金额应当原样带出，实际 %q", *got.Amount)
	}
	if got.Status != adminapi.CostStatus("partial") {
		t.Errorf("状态应当是 partial，实际 %v", got.Status)
	}
}

// 状态为空时按「没有用量」处理，不是「已算好」。
func TestMoneyDefaultsToNoUsage(t *testing.T) {
	if got := money("", ""); got.Status != adminapi.CostStatus("no_usage") {
		t.Errorf("空状态应当当作 no_usage，实际 %v", got.Status)
	}
}

// 游标要能原样往返。
func TestCursorRoundTrip(t *testing.T) {
	when := time.Date(2026, 8, 20, 13, 45, 6, 123456789, time.UTC)
	token := encodeCursor(when, "usr_abc")

	gotTime, gotID := decodeCursor(&token)
	if gotTime == nil || gotID == nil {
		t.Fatal("游标应当解得出来")
	}
	if !gotTime.Equal(when) {
		t.Errorf("时间不一致：%v vs %v", gotTime, when)
	}
	if *gotID != "usr_abc" {
		t.Errorf("ID 不一致：%q", *gotID)
	}
}

// 游标解析不了时当作没有游标，从头开始。
//
// 报错也说得通，但游标是客户端原样回传的，报错只会把一个能自愈的场景
// 变成一个卡住的页面。
func TestBadCursorFallsBackToStart(t *testing.T) {
	for name, bad := range map[string]string{
		"不是 base64": "!!!not-base64!!!",
		"缺分隔符":      "YWJjZGVm",
		"时间不合法":     "bm90LWEtdGltZXx1c3JfYWJj",
		"空串":        "",
	} {
		t.Run(name, func(t *testing.T) {
			cursor := bad
			gotTime, gotID := decodeCursor(&cursor)
			if gotTime != nil || gotID != nil {
				t.Errorf("坏游标应当当作没有游标，实际 %v %v", gotTime, gotID)
			}
		})
	}
	// nil 同样按没有游标处理。
	if gotTime, gotID := decodeCursor(nil); gotTime != nil || gotID != nil {
		t.Error("nil 游标应当当作没有游标")
	}
}

// 游标是不透明的：客户端不该能从里面读出东西。
//
// 编码不是为了保密，是为了**让人没法去解析它**——一旦有人开始拼游标，
// 分页的实现就再也改不动了。
func TestCursorIsOpaque(t *testing.T) {
	token := encodeCursor(time.Now(), "usr_secret")
	if len(token) == 0 {
		t.Fatal("游标不该为空")
	}
	for _, leak := range []string{"usr_secret", "|", "2026"} {
		if contains(token, leak) {
			t.Errorf("游标里不该直接出现 %q：%s", leak, token)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// 每页条数有上限。
//
// 不设上限的话，一个 limit=1000000 就能把整张表拉出来——
// 后台的每一行都是运营数据，一次全量导出的影响和一次泄漏差不多。
func TestLimitIsBounded(t *testing.T) {
	if got := limitOf(nil); got != 20 {
		t.Errorf("默认应当是 20，实际 %d", got)
	}
	huge := 1000000
	if got := limitOf(&huge); got != 100 {
		t.Errorf("超过上限应当截到 100，实际 %d", got)
	}
	zero := 0
	if got := limitOf(&zero); got != 20 {
		t.Errorf("0 应当退回默认值，实际 %d", got)
	}
	negative := -5
	if got := limitOf(&negative); got != 20 {
		t.Errorf("负数应当退回默认值，实际 %d", got)
	}
}

// 漏斗每一步都要给出转化率，且分母为 0 时留空。
func TestBuildFunnelHandlesZeroStart(t *testing.T) {
	steps := buildFunnel([]rawStep{
		{"注册", 0, 0},
		{"初始化", 0, 0},
	})
	if len(steps) != 2 {
		t.Fatalf("应当有两步，实际 %d", len(steps))
	}
	for _, s := range steps {
		if s.ConversionFromStart != nil {
			t.Errorf("起点为 0 时转化率应当留空，实际 %v", *s.ConversionFromStart)
		}
	}
}

func TestBuildFunnelComputesConversions(t *testing.T) {
	steps := buildFunnel([]rawStep{
		{"注册", 100, 100},
		{"初始化", 50, 50},
		{"首次操作", 25, 40},
	})

	if *steps[1].ConversionFromStart != 0.5 {
		t.Errorf("第二步相对起点应当是 0.5，实际 %v", *steps[1].ConversionFromStart)
	}
	if *steps[2].ConversionFromPrevious != 0.5 {
		t.Errorf("第三步相对上一步应当是 0.5，实际 %v", *steps[2].ConversionFromPrevious)
	}
	if *steps[2].ConversionFromStart != 0.25 {
		t.Errorf("第三步相对起点应当是 0.25，实际 %v", *steps[2].ConversionFromStart)
	}
	// 第一步没有「上一步」。
	if steps[0].ConversionFromPrevious != nil {
		t.Error("第一步不该有相对上一步的转化率")
	}
}
