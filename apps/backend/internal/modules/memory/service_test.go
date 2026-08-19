package memory

import (
	"bytes"
	"testing"
)

// 指纹必须能挡住"换一种说法"。
//
// 如果直接哈希用户原句，同一个偏好多打一个空格、换个大小写就是另一条指纹，
// "不再学这个"等于没有生效。
func TestFingerprintIgnoresSuperficialDifferences(t *testing.T) {
	svc := New(nil, []byte("test-key"))

	base := svc.fingerprint("routine.exercise_time", "一般晚上七点后运动")
	cases := []struct {
		name string
		key  string
		text string
	}{
		{"前后空白", "routine.exercise_time", "  一般晚上七点后运动  "},
		{"中间多余空格", "routine.exercise_time", "一般晚上七点后运动 "},
		{"键大小写", "Routine.Exercise_Time", "一般晚上七点后运动"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := svc.fingerprint(tc.key, tc.text); !bytes.Equal(got, base) {
				t.Error("规范化之后应当是同一条指纹")
			}
		})
	}
}

// 不同语义必须是不同指纹，否则会误挡住用户真正想记的东西。
func TestFingerprintSeparatesDifferentSemantics(t *testing.T) {
	svc := New(nil, []byte("test-key"))
	base := svc.fingerprint("routine.exercise_time", "一般晚上七点后运动")

	cases := map[string][2]string{
		"值不同": {"routine.exercise_time", "一般早上六点跑步"},
		"键不同": {"routine.sleep_time", "一般晚上七点后运动"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := svc.fingerprint(tc[0], tc[1]); bytes.Equal(got, base) {
				t.Error("语义不同的两条不该撞成同一条指纹")
			}
		})
	}
}

// 换一个密钥必须得到不同指纹：指纹不能反推出原文，也不能跨部署对撞。
func TestFingerprintDependsOnKey(t *testing.T) {
	a := New(nil, []byte("key-a")).fingerprint("k", "v")
	b := New(nil, []byte("key-b")).fingerprint("k", "v")
	if bytes.Equal(a, b) {
		t.Error("不同密钥应当产生不同指纹")
	}
}

// 模型给的类型与敏感级别不可信，必须收敛到契约枚举。
func TestMemoryTypeAndSensitivityAreClamped(t *testing.T) {
	if got := memoryTypeOr("随便编的类型"); got != "personal_context" {
		t.Errorf("未知类型应落到 personal_context，实际 %q", got)
	}
	if got := memoryTypeOr("constraint"); got != "constraint" {
		t.Errorf("已知类型应当保留，实际 %q", got)
	}
	if got := sensitivityOr(""); got != "normal" {
		t.Errorf("缺省应为 normal，实际 %q", got)
	}
	if got := sensitivityOr("highly_sensitive"); got != "highly_sensitive" {
		t.Errorf("高敏级别应当保留，实际 %q", got)
	}
	if got := sensitivityOr("公开"); got != "normal" {
		t.Errorf("未知级别应落到 normal，实际 %q", got)
	}
}

// 整句用户输入不该被当成关键词去做 ILIKE，否则一条记忆都匹配不上。
func TestKeywordOrNilDropsLongQueries(t *testing.T) {
	if got := keywordOrNil("跑步"); got == nil || *got != "跑步" {
		t.Error("短关键词应当保留")
	}
	if keywordOrNil("我一般晚上七点以后才有空去健身房，你帮我看看这周怎么安排") != nil {
		t.Error("整句输入不该当作关键词过滤")
	}
	if keywordOrNil("   ") != nil {
		t.Error("空白应当视为没有关键词")
	}
}

// 来源引用要能拆成契约允许的 source_type，认不出的直接丢弃而不是硬塞。
func TestSplitRefMapsToContractSourceTypes(t *testing.T) {
	cases := []struct {
		ref    string
		typ    string
		id     string
		wantOK bool
	}{
		{"task:tsk_1", "object", "tsk_1", true},
		{"note:nte_1", "object", "nte_1", true},
		{"record:rec_1", "record", "rec_1", true},
		{"message:amsg_1", "user_message", "amsg_1", true},
		{"secret:whatever", "", "", false},
		{"没有冒号", "", "", false},
		{"task:", "", "", false},
	}
	for _, tc := range cases {
		typ, id, ok := splitRef(tc.ref)
		if ok != tc.wantOK || typ != tc.typ || id != tc.id {
			t.Errorf("%q → (%q,%q,%v)，期望 (%q,%q,%v)",
				tc.ref, typ, id, ok, tc.typ, tc.id, tc.wantOK)
		}
	}
}
