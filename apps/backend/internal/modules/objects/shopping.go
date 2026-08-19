package objects

import (
	"sort"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

// 购物清单的确定性分类。
//
// 客户端不维护这套规则：同一件东西在两台设备上必须归到同一类，
// 而关键词表会随着用户反馈调整，放在服务端才能一次改完。
//
// 这是确定性代码，不是 AI：分不出来就归 other，不猜。
// 以后要用 AI 提高覆盖率，也只能作为待确认候选，不能直接改分类结果。

// shoppingKeywords 按品类列出关键词。
//
// 匹配时按关键词长度从长到短，不按这里的书写顺序：
// 「果汁」和「果」都能命中「苹果汁」，长的那个才是对的答案。
// 单字关键词是兜底，必须让位给更具体的词。
var shoppingKeywords = []struct {
	category httpapi.ShoppingCategory
	words    []string
}{
	{httpapi.ShoppingCategoryProduce, []string{
		"番茄", "西红柿", "黄瓜", "土豆", "洋葱", "胡萝卜", "白菜", "青菜", "菠菜",
		"生菜", "西兰花", "蘑菇", "香菇", "茄子", "辣椒", "豆角", "芹菜", "南瓜",
		"苹果", "香蕉", "橙子", "梨", "葡萄", "西瓜", "草莓", "柠檬", "牛油果",
		"蔬菜", "水果", "菜", "果",
	}},
	{httpapi.ShoppingCategoryProtein, []string{
		"牛肉", "猪肉", "鸡肉", "羊肉", "鸭", "排骨", "肉末", "肉",
		"鱼", "虾", "蟹", "贝", "三文鱼",
		"鸡蛋", "蛋", "牛奶", "酸奶", "奶酪", "黄油", "奶",
		"豆腐", "豆浆",
	}},
	{httpapi.ShoppingCategoryStaple, []string{
		"大米", "米", "面条", "挂面", "意面", "面粉", "面包", "馒头", "包子",
		"燕麦", "麦片", "玉米", "红薯",
		"食用油", "橄榄油", "油", "盐", "酱油", "醋", "糖", "料酒", "蚝油",
		"胡椒", "孜然", "淀粉", "酱",
	}},
	{httpapi.ShoppingCategoryBeverage, []string{
		"咖啡", "茶", "矿泉水", "苏打水", "果汁", "饮料", "可乐", "啤酒", "红酒",
		"奶茶", "冲调", "蛋白粉",
	}},
}

// rankedKeyword 是展平并按长度排好序的关键词。
type rankedKeyword struct {
	word     string
	category httpapi.ShoppingCategory
}

// rankedKeywords 在包初始化时展平，避免每次分类都重建一遍。
var rankedKeywords = buildRankedKeywords()

func buildRankedKeywords() []rankedKeyword {
	var out []rankedKeyword
	for _, group := range shoppingKeywords {
		for _, word := range group.words {
			out = append(out, rankedKeyword{word: word, category: group.category})
		}
	}
	// 长词在前，作为同一结束位置下的次级顺序。
	sort.SliceStable(out, func(i, j int) bool {
		return len([]rune(out[i].word)) > len([]rune(out[j].word))
	})
	return out
}

// ClassifyShoppingItem 按名称推断品类。
//
// 只看名称：数量与规格是自由文本（「一把」「300 克」），从里面推品类
// 只会引入噪音。
//
// 选词规则是「结束位置最靠后，同位置取更长的那个」。中文复合词的类别
// 通常由靠后的成分决定：「苹果汁」是饮料不是水果，而「牛肉末」两个候选
// 结束在同一处，这时更具体的「牛肉」胜出。
func ClassifyShoppingItem(title string) httpapi.ShoppingCategory {
	name := strings.TrimSpace(title)
	if name == "" {
		return httpapi.ShoppingCategoryOther
	}

	best := httpapi.ShoppingCategoryOther
	bestEnd := -1
	bestLen := 0
	for _, item := range rankedKeywords {
		index := strings.LastIndex(name, item.word)
		if index < 0 {
			continue
		}
		end := index + len(item.word)
		length := len([]rune(item.word))
		if end > bestEnd || (end == bestEnd && length > bestLen) {
			best, bestEnd, bestLen = item.category, end, length
		}
	}
	return best
}
