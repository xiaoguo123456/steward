package ai

import "testing"

func TestVisibleTextKeepsContextualShortAnswers(t *testing.T) {
	for _, value := range []string{"", " \n\t", "\u200b\u200c\u200d\ufeff"} {
		if HasVisibleText(value) {
			t.Fatal("全不可见输入未拒绝")
		}
	}
	for _, value := range []string{"3", "好的", "？", "👨‍👩‍👧", "买\u200d牛奶"} {
		if !HasVisibleText(value) {
			t.Fatal("有效正文被误删")
		}
	}
}
