package aliyunoss

import "testing"

func TestPrefixAndPhysicalKey(t *testing.T) {
	t.Parallel()

	prefix, err := normalizePrefix("/steward/test/")
	if err != nil {
		t.Fatalf("规范化前缀失败：%v", err)
	}
	store := &Store{prefix: prefix}
	if got, want := store.physicalKey("users/u1/media/a.jpg"), "steward/test/users/u1/media/a.jpg"; got != want {
		t.Fatalf("物理对象键 = %q，期望 %q", got, want)
	}
}

func TestNormalizePrefixRejectsTraversalAndEmptySegment(t *testing.T) {
	t.Parallel()

	for _, prefix := range []string{"steward/../prod", "steward//test", "./steward"} {
		if _, err := normalizePrefix(prefix); err == nil {
			t.Fatalf("前缀 %q 应被拒绝", prefix)
		}
	}
}
