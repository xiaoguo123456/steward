package recipes

import (
	"fmt"
	"testing"
	"time"
)

// 周菜单生成的规则测试。
//
// 这里守的不是「菜选得好不好」——那没有客观标准——而是几条硬规则：
// 只从给定的池子里选、一餐组成对、同 seed 同结果、一周内不重样、
// 妥协了必须说出来。过敏原本身在 SQL 里过滤，由 candidates_integration_test.go 覆盖。

var testWeek = time.Date(2026, 8, 17, 0, 0, 0, 0, time.UTC)

// makePool 造一批某个角色的候选菜，热量在 [lowCal, highCal] 上均匀铺开。
//
// **热量跨度要贴近真实库**：实测每份热量 p10=111、p50=318、p90=737。
// 早先的夹具下限定在 180，比低热量目标下每格该有的份额还高，
// 结构上就够不着目标——那样测出来的「偏差」是夹具的问题不是算法的。
func makePool(n int, prefix, component string, lowCal, highCal float64) []candidate {
	out := make([]candidate, 0, n)
	step := (highCal - lowCal) / float64(max(n-1, 1))
	for i := 0; i < n; i++ {
		fat := 8 + float64(i%7)*2
		out = append(out, candidate{
			ID:         fmt.Sprintf("%s_%03d", prefix, i),
			Title:      fmt.Sprintf("%s%03d", component, i),
			Component:  component,
			Minutes:    5 + i%50,
			Calories:   lowCal + float64(i)*step,
			ProteinG:   5 + float64(i%10)*3,
			CarbsG:     10 + float64((i*7)%40),
			FatG:       &fat,
			Categories: []string{[]string{"stir_fry", "soup", "staple", "cold"}[i%4]},
		})
	}
	return out
}

// fullPools 给每个时段每个角色都备足候选。
func fullPools() pools {
	out := pools{}
	for _, slot := range mealSlots {
		out[slot] = map[string][]candidate{
			"staple":    makePool(80, slot+"s", "staple", 80, 620),
			"one_dish":  makePool(40, slot+"o", "one_dish", 300, 800),
			"protein":   makePool(80, slot+"p", "protein", 60, 520),
			"vegetable": makePool(80, slot+"v", "vegetable", 30, 260),
		}
	}
	return out
}

func targetOf(calories float64) *EnergyTarget {
	return &EnergyTarget{Calories: calories, ProteinG: 110, CarbsG: 220, FatG: 60}
}

// 每一餐都要组成完整：早餐主食+蛋白，午晚主食+荤+素。
// 挑到单品成餐时它顶掉主食与荤菜，午晚只再配一道素菜。
func TestSuggestionBuildsCompleteMeals(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "balanced", targetOf(1800), fullPools())

	byMeal := map[string][]string{}
	for _, e := range got.Entries {
		key := e.Date.Format("01-02") + "/" + e.MealSlot
		byMeal[key] = append(byMeal[key], e.Component)
	}
	if len(byMeal) != daysPerWeek*len(mealSlots) {
		t.Fatalf("应当有 21 餐，实际 %d", len(byMeal))
	}

	for meal, components := range byMeal {
		has := map[string]bool{}
		for _, c := range components {
			has[c] = true
		}
		oneDish := has["one_dish"]
		switch {
		case oneDish && has["protein"]:
			t.Errorf("%s 已经有单品成餐，不该再配荤菜：%v", meal, components)
		case !oneDish && !(has["staple"] && has["protein"]):
			t.Errorf("%s 应当有主食和荤菜：%v", meal, components)
		}
		// 午晚不管走哪条路都要有素菜。
		if !oneDish && len(components) < 2 {
			t.Errorf("%s 组成不完整：%v", meal, components)
		}
	}
}

func TestSuggestionLunchAndDinnerIncludeVegetable(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "balanced", targetOf(1800), fullPools())

	byMeal := map[string]map[string]bool{}
	for _, e := range got.Entries {
		key := e.Date.Format("01-02") + "/" + e.MealSlot
		if byMeal[key] == nil {
			byMeal[key] = map[string]bool{}
		}
		byMeal[key][e.Component] = true
	}
	for meal, has := range byMeal {
		if len(meal) > 6 && meal[6:] == "breakfast" {
			// 早餐不配素菜，两样就够。
			if has["vegetable"] {
				t.Errorf("早餐不该排素菜：%s", meal)
			}
			continue
		}
		if !has["vegetable"] {
			t.Errorf("%s 应当有一道素菜", meal)
		}
	}
}

// 生成器只能从传进来的池子里选。
//
// 这条是过敏原安全的另一半：SQL 保证池子里没有过敏原，这里保证
// 生成器不会凭空冒出池子外的菜。两条合起来，过敏原才真的过滤掉了。
func TestSuggestionOnlyPicksFromPool(t *testing.T) {
	cases := map[string]pools{
		"候选充足": fullPools(),
		"候选很少": {
			"breakfast": {"staple": makePool(2, "a", "staple", 80, 620), "protein": makePool(2, "b", "protein", 60, 520)},
			"lunch":     {"staple": makePool(3, "c", "staple", 80, 620), "vegetable": makePool(1, "d", "vegetable", 30, 260)},
			"dinner":    {"protein": makePool(1, "e", "protein", 60, 520)},
		},
		"全空": {},
	}

	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			allowed := map[string]bool{}
			for _, slotPools := range p {
				for _, list := range slotPools {
					for _, c := range list {
						allowed[c.ID] = true
					}
				}
			}
			for seed := 0; seed < 4; seed++ {
				got := buildSuggestion(testWeek, seed, "balanced", targetOf(1800), p)
				for _, e := range got.Entries {
					if !allowed[e.RecipeID] {
						t.Fatalf("seed %d 选出了池子外的菜 %q", seed, e.RecipeID)
					}
				}
			}
		})
	}
}

// 同一个 seed 必须给出同一份菜单：客户端切走再切回来不该换菜。
func TestSuggestionIsDeterministic(t *testing.T) {
	first := buildSuggestion(testWeek, 7, "fat_loss", targetOf(1600), fullPools())
	second := buildSuggestion(testWeek, 7, "fat_loss", targetOf(1600), fullPools())

	if len(first.Entries) != len(second.Entries) {
		t.Fatalf("两次生成条目数不同：%d vs %d", len(first.Entries), len(second.Entries))
	}
	for i := range first.Entries {
		if first.Entries[i] != second.Entries[i] {
			t.Fatalf("第 %d 条不一致：%+v vs %+v", i, first.Entries[i], second.Entries[i])
		}
	}
}

// 换一批必须真的换出东西来，否则按钮等于没接。
func TestSuggestionChangesWithSeed(t *testing.T) {
	first := buildSuggestion(testWeek, 0, "balanced", targetOf(1800), fullPools())
	second := buildSuggestion(testWeek, 1, "balanced", targetOf(1800), fullPools())

	firstIDs := map[string]bool{}
	for _, e := range first.Entries {
		firstIDs[e.RecipeID] = true
	}
	same := 0
	for _, e := range second.Entries {
		if firstIDs[e.RecipeID] {
			same++
		}
	}
	if same > len(second.Entries)/2 {
		t.Errorf("换一批后 %d/%d 道没变，换得太少", same, len(second.Entries))
	}
}

// 一周之内不重样，跨餐次也算。
//
// 三个时段**共用同一批候选**，这是真实情况：库里能当午餐和晚餐的
// 绝大部分是同一批菜。各时段用互不相干的池子来测，跨时段去重那段代码
// 根本不会被执行到，测了等于没测。
func TestSuggestionNoRepeatWithinWeek(t *testing.T) {
	shared := map[string][]candidate{
		"staple":    makePool(60, "s", "staple", 80, 620),
		"one_dish":  makePool(30, "o", "one_dish", 300, 800),
		"protein":   makePool(60, "p", "protein", 60, 520),
		"vegetable": makePool(60, "v", "vegetable", 30, 260),
	}
	got := buildSuggestion(testWeek, 3, "balanced", targetOf(1800), pools{
		"breakfast": shared, "lunch": shared, "dinner": shared,
	})

	seen := map[string]string{}
	for _, e := range got.Entries {
		where := e.Date.Format("01-02") + "/" + e.MealSlot
		if prev, dup := seen[e.RecipeID]; dup {
			t.Errorf("%q 重复出现：%s 和 %s", e.RecipeID, prev, where)
		}
		seen[e.RecipeID] = where
	}
}

// 一道菜都筛不出来时留空，不能拿别的角色的菜硬凑，也不能崩。
func TestSuggestionEmptySlotIsLeftUnfilled(t *testing.T) {
	p := fullPools()
	p["breakfast"] = map[string][]candidate{}

	got := buildSuggestion(testWeek, 0, "balanced", targetOf(1800), p)
	for _, e := range got.Entries {
		if e.MealSlot == "breakfast" {
			t.Fatalf("早餐没有可选的菜，不该排出 %q", e.RecipeID)
		}
	}
	if len(got.Entries) == 0 {
		t.Error("另外两餐应当照常排")
	}
	found := false
	for _, n := range got.Notes {
		if n.Kind == "slot_unfilled" && n.MealSlot == "breakfast" {
			found = true
		}
	}
	if !found {
		t.Errorf("留空必须有 slot_unfilled 说明，实际 %+v", got.Notes)
	}
}

// 有热量目标时，实际排出来的量要向目标靠。
func TestSuggestionApproachesCalorieTarget(t *testing.T) {
	for _, want := range []float64{1400, 1800, 2400} {
		got := buildSuggestion(testWeek, 0, "balanced", targetOf(want), fullPools())
		gap := (got.Achieved.Calories - want) / want
		if gap < 0 {
			gap = -gap
		}
		if gap > targetTolerance {
			t.Errorf("目标 %.0f，实际每日 %.0f，差了 %.0f%%",
				want, got.Achieved.Calories, gap*100)
		}
	}
}

// 目标提高，排出来的量也要跟着提高——否则热量目标等于没接。
func TestSuggestionScalesWithTarget(t *testing.T) {
	low := buildSuggestion(testWeek, 0, "balanced", targetOf(1400), fullPools())
	high := buildSuggestion(testWeek, 0, "balanced", targetOf(2400), fullPools())
	if high.Achieved.Calories <= low.Achieved.Calories {
		t.Errorf("目标 2400 排出来的应当多于目标 1400：%.0f vs %.0f",
			high.Achieved.Calories, low.Achieved.Calories)
	}
}

// 凑不到目标要说出来，不能默默给一份差很远的。
func TestSuggestionReportsUnreachableTarget(t *testing.T) {
	// 池子里全是很轻的菜，凑不到 3000 千卡。
	thin := pools{}
	for _, slot := range mealSlots {
		thin[slot] = map[string][]candidate{
			"staple":    makePool(30, slot+"s", "staple", 40, 90),
			"protein":   makePool(30, slot+"p", "protein", 30, 80),
			"vegetable": makePool(30, slot+"v", "vegetable", 20, 50),
		}
	}
	got := buildSuggestion(testWeek, 0, "balanced", targetOf(3000), thin)

	found := false
	for _, n := range got.Notes {
		if n.Kind == "target_unreachable" {
			found = true
		}
	}
	if !found {
		t.Errorf("凑不到目标必须说明，实际每日 %.0f，notes %+v",
			got.Achieved.Calories, got.Notes)
	}
}

// 身体数据不全时没有目标，仍然要排得出一份完整菜单。
func TestSuggestionWorksWithoutTarget(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "fat_loss", nil, fullPools())

	if len(got.Entries) < daysPerWeek*len(mealSlots) {
		t.Errorf("没有热量目标也该排满三餐，实际 %d 条", len(got.Entries))
	}
	if got.DailyTarget != nil {
		t.Error("没有目标时 DailyTarget 应当为空")
	}
	if got.Achieved.Calories <= 0 {
		t.Error("实际值仍然要算出来")
	}
	for _, n := range got.Notes {
		if n.Kind == "target_unreachable" {
			t.Error("没有目标就不该报「凑不到目标」")
		}
	}
}

// 有一道菜缺脂肪数据，整周那一项就算不出来。
//
// 关键是**不能把缺的当 0 加进去**：那样会给出一个偏低、
// 且从数字本身看不出偏低的结果。
func TestAchievedLeavesUnknownFatEmpty(t *testing.T) {
	p := fullPools()
	// 把午餐素菜里的脂肪全抹掉，模拟手写内容。
	for i := range p["lunch"]["vegetable"] {
		p["lunch"]["vegetable"][i].FatG = nil
	}
	got := buildSuggestion(testWeek, 0, "balanced", targetOf(1800), p)
	if got.Achieved.FatG != nil {
		t.Errorf("有菜缺脂肪就不该给出数字，实际 %v", *got.Achieved.FatG)
	}
	if got.Achieved.Calories <= 0 {
		t.Error("热量应当照常求和")
	}
}

// 排名必须是全序：同分的菜按 ID 定序，否则同样输入会给出不同菜单。
func TestGoalScoresHandleTiesAndSingletons(t *testing.T) {
	same := []candidate{
		{ID: "c", Component: "protein", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
		{ID: "a", Component: "protein", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
		{ID: "b", Component: "protein", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
	}
	scores := goalScores(same, "balanced", "lunch")
	if scores["a"] != scores["b"] || scores["b"] != scores["c"] {
		t.Errorf("完全一样的菜应当同分，实际 %v", scores)
	}

	single := goalScores([]candidate{{ID: "only", Calories: 300}}, "fat_loss", "lunch")
	if single["only"] != 1 {
		t.Errorf("单道菜不该算出 NaN，实际 %v", single["only"])
	}
}
