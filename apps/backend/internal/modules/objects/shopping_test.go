package objects

import (
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

func TestClassifyShoppingItem(t *testing.T) {
	cases := []struct {
		title string
		want  httpapi.ShoppingCategory
	}{
		{"番茄", httpapi.ShoppingCategoryProduce},
		{"牛肉末", httpapi.ShoppingCategoryProtein},
		{"牛奶", httpapi.ShoppingCategoryProtein},
		{"大米", httpapi.ShoppingCategoryStaple},
		{"咖啡豆", httpapi.ShoppingCategoryBeverage},
		{"充电线", httpapi.ShoppingCategoryOther},
		{"", httpapi.ShoppingCategoryOther},
		{"  番茄  ", httpapi.ShoppingCategoryProduce},
	}
	for _, tc := range cases {
		if got := ClassifyShoppingItem(tc.title); got != tc.want {
			t.Errorf("%q → %q，期望 %q", tc.title, got, tc.want)
		}
	}
}

// 长词必须盖过短词，否则单字兜底会把更具体的名字带偏。
func TestClassifyPrefersLongerKeyword(t *testing.T) {
	cases := []struct {
		title string
		want  httpapi.ShoppingCategory
		why   string
	}{
		{"苹果汁", httpapi.ShoppingCategoryBeverage, "「果汁」应当盖过「果」"},
		{"食用油", httpapi.ShoppingCategoryStaple, "「食用油」应当盖过「油」"},
		{"橄榄油", httpapi.ShoppingCategoryStaple, "「橄榄油」应当盖过「油」"},
		{"西兰花", httpapi.ShoppingCategoryProduce, "「西兰花」是具体的菜"},
	}
	for _, tc := range cases {
		if got := ClassifyShoppingItem(tc.title); got != tc.want {
			t.Errorf("%q → %q，期望 %q（%s）", tc.title, got, tc.want, tc.why)
		}
	}
}

// 同一个名字每次必须归到同一类：客户端不维护这套规则，
// 它必须能相信服务端的答案是稳定的。
func TestClassifyIsDeterministic(t *testing.T) {
	for i := 0; i < 50; i++ {
		if got := ClassifyShoppingItem("牛奶"); got != httpapi.ShoppingCategoryProtein {
			t.Fatalf("第 %d 次分类结果变了：%q", i, got)
		}
	}
}

func TestMergeQuantityKeepsDistinctParts(t *testing.T) {
	existing := "2 个 + 少许"
	got := mergeQuantity(&existing, "少许 + 3 个")
	if got == nil || *got != "2 个 + 少许 + 3 个" {
		t.Fatalf("份量应去重并保持顺序，实际 %v", got)
	}
}

func TestMergeQuantityLeavesEmptyAsNil(t *testing.T) {
	if got := mergeQuantity(nil, "  "); got != nil {
		t.Fatalf("空份量应保持为空，实际 %q", *got)
	}
}
