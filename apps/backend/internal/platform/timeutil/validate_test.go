package timeutil

import "testing"

// LoadLocation 是**读取**语义：它面对的是已经存在于库里的值，
// 不能因为一个坏值让请求整个失败，所以它回退。
//
// 但写入侧需要相反的语义：坏值必须当场拒绝，否则它会被存下来，
// 之后每一次日期计算都悄悄用回退时区算——结果不报错，只是错。
// 两种语义必须是两个函数，用错一个不会有任何征兆。
func TestValidateLocationRejectsGarbage(t *testing.T) {
	for _, name := range []string{"这不是时区", "Not/A_Zone", "评测用户", "UTC+8", " "} {
		if err := ValidateLocation(name); err == nil {
			t.Errorf("ValidateLocation(%q) 应当拒绝，实际通过了", name)
		}
	}
}

func TestValidateLocationAcceptsRealZones(t *testing.T) {
	for _, name := range []string{"Asia/Shanghai", "America/New_York", "Europe/London", "UTC"} {
		if err := ValidateLocation(name); err != nil {
			t.Errorf("ValidateLocation(%q) 应当通过，实际报错：%v", name, err)
		}
	}
}

// 空字符串表示「跟随默认」，是合法的省略而不是坏值。
func TestValidateLocationAllowsEmpty(t *testing.T) {
	if err := ValidateLocation(""); err != nil {
		t.Errorf("空时区应当视为省略，实际报错：%v", err)
	}
}

// 这条守着最初的写法：用 LoadLocation 去做校验永远不会失败，
// 因为它的错误路径就是「回退」而不是「返回错误」。
func TestLoadLocationNeverSignalsFailure(t *testing.T) {
	loc := LoadLocation("这不是时区")
	if loc == nil {
		t.Fatal("LoadLocation 不应返回 nil")
	}
	if loc.String() != DefaultTimezone {
		t.Fatalf("非法时区应回退到 %s，实际 %s", DefaultTimezone, loc)
	}
}
