package recipes

import (
	"fmt"
	"testing"
	"time"
)

// 周菜单生成的规则测试。
//
// 这里守的不是「菜选得好不好」——那没有客观标准——而是几条硬规则：
// 只从给定的池子里选、同 seed 同结果、一周内不重样、
// 妥协了必须说出来。过敏原本身在 SQL 里过滤，由 TestCandidateQuery* 覆盖。

var testWeek = time.Date(2026, 8, 17, 0, 0, 0, 0, time.UTC)

// pool 造一批候选菜。
// 热量与蛋白刻意不相关：否则分不清目标打分到底在看哪一项。
func pool(n int, prefix string) []candidate {
	out := make([]candidate, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, candidate{
			ID:         fmt.Sprintf("%s_%03d", prefix, i),
			Title:      fmt.Sprintf("菜%03d", i),
			Minutes:    5 + i%50,
			Calories:   150 + float64(i)*10,
			ProteinG:   5 + float64(i%10)*4,
			CarbsG:     10 + float64((i*7)%40),
			Categories: []string{[]string{"stir_fry", "soup", "staple", "cold"}[i%4]},
		})
	}
	return out
}

func fullPools() map[string][]candidate {
	return map[string][]candidate{
		"breakfast": pool(120, "b"),
		"lunch":     pool(120, "l"),
		"dinner":    pool(120, "d"),
	}
}

func TestSuggestionFillsWholeWeek(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "balanced", fullPools())

	if len(got.Entries) != daysPerWeek*len(mealSlots) {
		t.Fatalf("候选充足时应当排满 21 格，实际 %d", len(got.Entries))
	}
	if len(got.Notes) != 0 {
		t.Errorf("没有妥协就不该有 notes，实际 %+v", got.Notes)
	}
	// 日期必须是这一周的七天，一天三餐。
	perDay := map[string]int{}
	for _, e := range got.Entries {
		perDay[e.Date.Format("2006-01-02")]++
	}
	if len(perDay) != daysPerWeek {
		t.Errorf("应当覆盖 7 天，实际 %d 天", len(perDay))
	}
	for day, count := range perDay {
		if count != 3 {
			t.Errorf("%s 应当有三餐，实际 %d", day, count)
		}
	}
}

// 生成器只能从传进来的池子里选。
//
// 这条是过敏原安全的另一半：SQL 保证池子里没有过敏原，这里保证
// 生成器不会凭空冒出池子外的菜。两条合起来，过敏原才真的过滤掉了。
func TestSuggestionOnlyPicksFromPool(t *testing.T) {
	cases := map[string]map[string][]candidate{
		"候选充足": fullPools(),
		"候选很少": {
			"breakfast": pool(2, "b"),
			"lunch":     pool(3, "l"),
			"dinner":    pool(1, "d"),
		},
		// 三个时段共用同一批菜且只有两道：跨时段抢完之后仍不能越界。
		"共用且不足": {
			"breakfast": pool(2, "s"),
			"lunch":     pool(2, "s"),
			"dinner":    pool(2, "s"),
		},
	}

	for name, pools := range cases {
		t.Run(name, func(t *testing.T) {
			allowed := map[string]bool{}
			for _, list := range pools {
				for _, c := range list {
					allowed[c.ID] = true
				}
			}
			for seed := 0; seed < 5; seed++ {
				got := buildSuggestion(testWeek, seed, "balanced", pools)
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
	first := buildSuggestion(testWeek, 7, "fat_loss", fullPools())
	second := buildSuggestion(testWeek, 7, "fat_loss", fullPools())

	if len(first.Entries) != len(second.Entries) {
		t.Fatalf("两次生成条目数不同：%d vs %d", len(first.Entries), len(second.Entries))
	}
	for i := range first.Entries {
		if first.Entries[i] != second.Entries[i] {
			t.Fatalf("第 %d 格不一致：%+v vs %+v", i, first.Entries[i], second.Entries[i])
		}
	}
}

// 换一批必须真的换出东西来，否则按钮等于没接。
func TestSuggestionChangesWithSeed(t *testing.T) {
	first := buildSuggestion(testWeek, 0, "balanced", fullPools())
	second := buildSuggestion(testWeek, 1, "balanced", fullPools())

	same := 0
	for i := range first.Entries {
		if first.Entries[i].RecipeID == second.Entries[i].RecipeID {
			same++
		}
	}
	// 允许有重合（好菜池就那么大），但不能几乎原样。
	if same > len(first.Entries)/2 {
		t.Errorf("换一批后 %d/%d 格没变，换得太少", same, len(first.Entries))
	}
}

// 一周之内不重样，跨餐次也算——午餐吃过的晚上再来一遍，
// 用户会觉得这个功能没在干活。
//
// 三个时段**共用同一批候选**，这是真实情况：库里 2591 道能当午餐、
// 2612 道能当晚餐，绝大部分是同一批菜。各时段用互不相干的池子来测，
// 跨时段去重那段代码根本不会被执行到，测了等于没测。
func TestSuggestionNoRepeatWithinWeek(t *testing.T) {
	shared := pool(60, "s")
	got := buildSuggestion(testWeek, 3, "balanced", map[string][]candidate{
		"breakfast": shared, "lunch": shared, "dinner": shared,
	})

	if len(got.Entries) != daysPerWeek*len(mealSlots) {
		t.Fatalf("60 道菜够排满 21 格，实际 %d", len(got.Entries))
	}
	seen := map[string]string{}
	for _, e := range got.Entries {
		if where, dup := seen[e.RecipeID]; dup {
			t.Errorf("%q 重复出现：%s 和 %s/%s", e.RecipeID, where,
				e.Date.Format("01-02"), e.MealSlot)
		}
		seen[e.RecipeID] = e.Date.Format("01-02") + "/" + e.MealSlot
	}
}

// 候选不够一周时可以重复，但必须说出来。
// 悄悄重复会让人以为是 bug；说明白了用户知道该去放宽筛选条件。
func TestSuggestionSmallPoolRepeatsAndSaysSo(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "balanced", map[string][]candidate{
		"breakfast": pool(3, "b"),
		"lunch":     pool(120, "l"),
		"dinner":    pool(120, "d"),
	})

	if len(got.Entries) != daysPerWeek*len(mealSlots) {
		t.Errorf("即使候选不足也应当排满，实际 %d 格", len(got.Entries))
	}
	var note *SuggestionNote
	for i := range got.Notes {
		if got.Notes[i].Kind == "pool_repeats" && got.Notes[i].MealSlot == "breakfast" {
			note = &got.Notes[i]
		}
	}
	if note == nil {
		t.Fatalf("早餐候选只有 3 道，应当有 pool_repeats 说明，实际 %+v", got.Notes)
	}
	if got.Candidates["breakfast"] != 3 {
		t.Errorf("candidates 应当如实报 3，实际 %d", got.Candidates["breakfast"])
	}
}

// 一道菜都筛不出来时留空，不能拿别的时段的菜硬凑，也不能崩。
func TestSuggestionEmptySlotIsLeftUnfilled(t *testing.T) {
	got := buildSuggestion(testWeek, 0, "balanced", map[string][]candidate{
		"breakfast": nil,
		"lunch":     pool(120, "l"),
		"dinner":    pool(120, "d"),
	})

	for _, e := range got.Entries {
		if e.MealSlot == "breakfast" {
			t.Fatalf("早餐没有可选的菜，不该排出 %q", e.RecipeID)
		}
	}
	if len(got.Entries) != daysPerWeek*2 {
		t.Errorf("另外两餐应当照常排满，实际 %d 格", len(got.Entries))
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

// 目标要真的影响选菜，否则问卷填了等于没填。
func TestSuggestionGoalShiftsSelection(t *testing.T) {
	// 用午餐比：早餐额外加了「快」的权重，会盖过目标差异。
	lunchOnly := func(goal string) (avgCalories, avgProtein float64) {
		got := buildSuggestion(testWeek, 0, goal, map[string][]candidate{
			"lunch": pool(120, "l"),
		})
		byID := map[string]candidate{}
		for _, c := range pool(120, "l") {
			byID[c.ID] = c
		}
		var cal, protein float64
		var n float64
		for _, e := range got.Entries {
			c := byID[e.RecipeID]
			cal += c.Calories
			protein += c.ProteinG
			n++
		}
		return cal / n, protein / n
	}

	fatLossCal, _ := lunchOnly("fat_loss")
	muscleCal, muscleProtein := lunchOnly("muscle_gain")
	_, fatLossProtein := lunchOnly("fat_loss")

	if fatLossCal >= muscleCal {
		t.Errorf("减脂选出的平均热量应当低于增肌：%.0f vs %.0f", fatLossCal, muscleCal)
	}
	if muscleProtein <= fatLossProtein*0.9 {
		t.Errorf("增肌选出的平均蛋白不该低于减脂：%.1f vs %.1f", muscleProtein, fatLossProtein)
	}
}

// 控糖目标要压低碳水供能占比。
func TestSuggestionSteadySugarPrefersLowCarbShare(t *testing.T) {
	share := func(goal string) float64 {
		got := buildSuggestion(testWeek, 0, goal, map[string][]candidate{
			"lunch": pool(120, "l"),
		})
		byID := map[string]candidate{}
		for _, c := range pool(120, "l") {
			byID[c.ID] = c
		}
		var total, n float64
		for _, e := range got.Entries {
			c := byID[e.RecipeID]
			total += c.CarbsG * 4 / max1(c.Calories)
			n++
		}
		return total / n
	}

	if share("steady_sugar") >= share("balanced") {
		t.Errorf("控糖的碳水占比应当低于均衡：%.3f vs %.3f",
			share("steady_sugar"), share("balanced"))
	}
}

// 排名必须是全序：同分的菜按 ID 定序，否则同样输入会给出不同菜单。
func TestRankByGoalIsTotalOrder(t *testing.T) {
	same := []candidate{
		{ID: "c", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
		{ID: "a", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
		{ID: "b", Calories: 300, ProteinG: 20, CarbsG: 30, Minutes: 10},
	}
	got := rankByGoal(same, "balanced", "lunch")
	if got[0].ID != "a" || got[1].ID != "b" || got[2].ID != "c" {
		t.Errorf("同分应当按 ID 定序，实际 %s %s %s", got[0].ID, got[1].ID, got[2].ID)
	}
}

// 单道菜不能把排名算出 NaN（percentiles 的分母是 len-1）。
func TestRankByGoalHandlesSingleCandidate(t *testing.T) {
	got := rankByGoal([]candidate{{ID: "only", Calories: 300}}, "fat_loss", "lunch")
	if len(got) != 1 || got[0].ID != "only" {
		t.Fatalf("单道菜应当原样返回，实际 %+v", got)
	}
}
