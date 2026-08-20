package aiaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// 审计的第一条规矩是**不存正文**。
//
// 这条用反射守：Entry 里只要出现任何一个能装下原文的字符串字段，
// 这个测试就失败。靠人复核「有没有人加了个 InputText 字段」不可靠——
// 加字段的人多半觉得自己有正当理由。
func TestEntryHasNoPlaintextFields(t *testing.T) {
	// 允许存在的字符串字段，都是标识符或有限枚举，不是用户正文。
	allowed := map[string]bool{
		"UserID": true, "Feature": true, "RunID": true,
		"EngineType": true, "EngineVersion": true, "Provider": true,
		"ModelPolicy": true, "ProviderModel": true,
		"PromptVersion": true, "SchemaVersion": true,
		"Status": true, "ErrorClass": true,
	}

	entry := reflect.TypeOf(Entry{})
	for i := 0; i < entry.NumField(); i++ {
		f := entry.Field(i)
		switch f.Type.Kind() {
		case reflect.String:
			if !allowed[f.Name] {
				t.Errorf("Entry.%s 是字符串字段，审计表不存正文——"+
					"要记内容请改成哈希，或放进 InputRefs 只记资源 ID", f.Name)
			}
		case reflect.Slice:
			// InputRefs 是资源 ID 列表，哈希是字节切片，都可以。
			if f.Name != "InputRefs" && f.Type.Elem().Kind() == reflect.String {
				t.Errorf("Entry.%s 是字符串切片，可能装得下正文", f.Name)
			}
		}
	}
}

func TestHashIsStableAndDistinguishing(t *testing.T) {
	if !bytes.Equal(Hash("a", "b"), Hash("a", "b")) {
		t.Error("同样的输入应当得到同样的哈希")
	}
	if bytes.Equal(Hash("a", "b"), Hash("b", "a")) {
		t.Error("顺序不同应当得到不同的哈希")
	}
	// 分段之间要有分隔，否则 ("ab","c") 与 ("a","bc") 会撞在一起。
	if bytes.Equal(Hash("ab", "c"), Hash("a", "bc")) {
		t.Error("分段边界不同却撞成了同一个哈希")
	}
	if Hash() != nil {
		t.Error("没有输入时应当返回 nil，而不是空串的哈希")
	}
}

// 哈希不能反推出原文，也不该在长度上泄漏原文规模。
func TestHashIsFixedLength(t *testing.T) {
	short := Hash("嗯")
	long := Hash(strings.Repeat("这是一段很长的用户输入。", 500))
	if len(short) != len(long) {
		t.Errorf("哈希长度应当固定，实际 %d vs %d", len(short), len(long))
	}
}

func TestClassifyErrorMapsSentinels(t *testing.T) {
	cases := map[error]string{
		nil:                       "",
		ai.ErrRateLimited:         "rate_limited",
		ai.ErrProviderUnavailable: "provider_unavailable",
		ai.ErrSchemaInvalid:       "schema_invalid",
		ai.ErrTurnCancelled:       "cancelled",
		context.DeadlineExceeded:  "timeout",
		context.Canceled:          "cancelled",
	}
	for err, want := range cases {
		if got := ClassifyError(err); got != want {
			t.Errorf("%v 应当归为 %q，实际 %q", err, want, got)
		}
	}

	// 包装过的哨兵仍然要认出来：适配器返回的都是 %w 包装的。
	wrapped := fmt.Errorf("%w: HTTP 429", ai.ErrRateLimited)
	if got := ClassifyError(wrapped); got != "rate_limited" {
		t.Errorf("包装过的限流错误应当仍归为 rate_limited，实际 %q", got)
	}
}

// 分类的取值必须有限，不能把原始错误信息带进去。
//
// 错误里常常包含用户输入的片段；而且成千上万个只出现一次的取值
// 也根本聚不了合，审计就白记了。
func TestClassifyErrorDoesNotLeakMessage(t *testing.T) {
	secret := "用户说他明天要去协和医院看肿瘤科"
	got := ClassifyError(errors.New(secret))
	if strings.Contains(got, secret) {
		t.Errorf("分类里带出了错误正文：%q", got)
	}
	if got != "unknown" {
		t.Errorf("认不出来的错误应当归为 unknown，实际 %q", got)
	}

	// apperr 的 Code 是有限枚举，可以直接用。
	if got := ClassifyError(apperr.New(apperr.CodeValidationFailed)); got != "VALIDATION_FAILED" {
		t.Errorf("apperr 应当用它的 Code，实际 %q", got)
	}
}

func TestStatusFor(t *testing.T) {
	if StatusFor(nil) != StatusSucceeded {
		t.Error("没有错误应当是 succeeded")
	}
	if StatusFor(errors.New("x")) != StatusFailed {
		t.Error("有错误应当是 failed")
	}
}

// 没有 Recorder（评测、单测）时写入是空操作，不能崩。
func TestNilRecorderIsNoop(t *testing.T) {
	var r *Recorder
	r.Record(context.Background(), Entry{UserID: "u", Feature: FeatureCapture, Status: StatusSucceeded})

	withoutDB := New(nil, nil)
	withoutDB.Record(context.Background(), Entry{UserID: "u", Feature: FeatureCapture, Status: StatusSucceeded})
}

// InputRefs 是资源 ID，序列化出来必须是数组而不是 null，
// 否则会撞上列上的 NOT NULL DEFAULT '[]'。
func TestInputRefsMarshalsAsArray(t *testing.T) {
	raw, err := json.Marshal(orEmpty(nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "[]" {
		t.Errorf("空的 InputRefs 应当序列化成 []，实际 %s", raw)
	}
}
