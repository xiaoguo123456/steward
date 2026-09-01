package captures

import "testing"

func TestNormalizeDuplicateText(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"  Hello\tWORLD！  ": "hello world!",
		"项目　（第一期）":          "项目 (第一期)",
		"中文，标点":             "中文,标点",
	}
	for input, want := range cases {
		if got := normalizeDuplicateText(input); got != want {
			t.Fatalf("normalizeDuplicateText(%q) = %q，期望 %q", input, got, want)
		}
	}
}
