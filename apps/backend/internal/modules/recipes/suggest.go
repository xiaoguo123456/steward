package recipes

import (
	"context"
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// 周菜单生成。
//
// 一餐是一个**组合**，不是一道菜：早餐主食+蛋白，午晚主食+荤+素。
// 挑到「单品成餐」（牛肉面、蛋包饭）时它顶掉主食与荤菜两格，
// 午晚再配一道素菜——一碗面再配一荤一素就成了三道菜的午饭，没人这么吃。
//
// 规则优先级，从高到低：
//
//  1. **过敏原与忌口**。在 SQL 里过滤，任何情况下都不放宽。
//     可选菜再少也宁可留空——为了填满一周而放宽过敏原，
//     是这个功能唯一能造成人身伤害的方式。
//  2. **一周不重样**，跨餐次也算。
//  3. **热量与碳蛋脂目标**。按身高体重算出每日目标再分摊到每餐；
//     身体数据不全时退回按营养排名打分，不拿默认值顶上。
//
// 全程确定性、不调用模型：同样的档案与 seed 必然得到同样的菜单。

// mealSlots 是一天三餐的固定顺序。
var mealSlots = []string{"breakfast", "lunch", "dinner"}

const daysPerWeek = 7

// 一餐由哪些角色组成。主食那一格从 staple 与 one_dish 里一起挑。
var mealShapes = map[string][]string{
	"breakfast": {"staple", "protein"},
	"lunch":     {"staple", "protein", "vegetable"},
	"dinner":    {"staple", "protein", "vegetable"},
}

// 一餐的热量在各角色之间怎么分。
//
// 主食与荤菜大致对半，素菜占两成——这和「餐盘里蔬菜占一半」不冲突：
// 蔬菜占的是体积，热量本来就低。
var componentShares = map[string]map[string]float64{
	"breakfast": {"staple": 0.55, "protein": 0.45, "one_dish": 1.00},
	"lunch":     {"staple": 0.40, "protein": 0.38, "vegetable": 0.22, "one_dish": 0.78},
	"dinner":    {"staple": 0.40, "protein": 0.38, "vegetable": 0.22, "one_dish": 0.78},
}

// scorePoolSize 是进入随机化的「好菜池」大小。
//
// 只在打分最高的这些里随机：全池随机等于没打分，只取第一名则
// 「换一批」换不出东西来。
const scorePoolSize = 25

// targetTolerance 是实际值偏离目标多少就要告诉用户。
const targetTolerance = 0.20

// SuggestionNote 说明本次生成做了什么妥协。
type SuggestionNote struct {
	Kind     string
	Message  string
	MealSlot string
}

// SuggestedEntry 是建议里的一道菜。
type SuggestedEntry struct {
	Date      time.Time
	MealSlot  string
	RecipeID  string
	Component string
}

// Achieved 是这份菜单实际算出来的每日平均值。
type Achieved struct {
	Calories float64
	ProteinG float64
	CarbsG   float64
	FatG     *float64
}

// Suggestion 是一份未确认的周菜单。
type Suggestion struct {
	WeekStart   time.Time
	Seed        int
	Entries     []SuggestedEntry
	Candidates  map[string]int
	DailyTarget *EnergyTarget
	Achieved    Achieved
	Notes       []SuggestionNote
}

// candidate 是打分需要的全部信息。刻意不含食材与步骤：
// 候选集有几千行，带上 JSON 正文白白多出几十兆。
type candidate struct {
	ID         string
	Title      string
	Component  string
	Minutes    int
	Calories   float64
	ProteinG   float64
	CarbsG     float64
	FatG       *float64
	Categories []string
}

func candidateOf(row dbgen.ListRecipeCandidatesRow) candidate {
	c := candidate{
		ID:         row.ID,
		Title:      row.Title,
		Minutes:    int(row.DurationMinutes),
		Calories:   row.Calories,
		ProteinG:   row.ProteinG,
		CarbsG:     row.CarbsG,
		FatG:       row.FatG,
		Categories: row.Categories,
	}
	if row.Component != nil {
		c.Component = *row.Component
	}
	return c
}

// pools 是「时段 → 角色 → 候选」。
type pools map[string]map[string][]candidate

// SuggestMealPlan 按用户的饮食档案生成一周菜单建议。
func (s *Service) SuggestMealPlan(ctx context.Context, userID string,
	weekStart time.Time, seed int) (Suggestion, error) {

	profile, err := s.DietProfile(ctx, userID)
	if err != nil {
		return Suggestion{}, err
	}

	target, hasTarget := DailyEnergyTarget(profile)
	var notes []SuggestionNote
	if hasTarget {
		notes = append(notes, target.Notes...)
	} else {
		notes = append(notes, SuggestionNote{
			Kind:    "profile_incomplete",
			Message: "填上身高、体重和年龄，就能按你的热量目标安排每餐的份量。这次先按营养均衡程度挑。",
		})
	}

	allPools := pools{}
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, slot := range mealSlots {
			allPools[slot] = map[string][]candidate{}
			for _, component := range []string{"staple", "one_dish", "protein", "vegetable"} {
				rows, err := s.candidatesFor(ctx, q, profile, slot, component, profile.MaxCookMinutes)
				if err != nil {
					return err
				}
				// 可选菜太少时放宽「最长烹饪时间」再试一次。
				//
				// 时长是偏好，放宽了顶多让人多花十分钟，而且这里会明说；
				// 过敏原是安全条件，没有对应的放宽分支，将来也不要加。
				if len(rows) < daysPerWeek && profile.MaxCookMinutes != nil {
					relaxed, err := s.candidatesFor(ctx, q, profile, slot, component, nil)
					if err != nil {
						return err
					}
					if len(relaxed) > len(rows) {
						rows = relaxed
						notes = appendOnce(notes, SuggestionNote{
							Kind: "cook_time_relaxed",
							Message: fmt.Sprintf("能在 %d 分钟内做完的菜太少，这次放宽了时间限制。",
								*profile.MaxCookMinutes),
						})
					}
				}
				allPools[slot][component] = rows
			}
		}
		return nil
	})
	if err != nil {
		return Suggestion{}, err
	}

	var targetPtr *EnergyTarget
	if hasTarget {
		targetPtr = &target
	}
	out := buildSuggestion(weekStart, seed, string(profile.Goal), targetPtr, allPools)
	out.Notes = append(notes, out.Notes...)
	return out, nil
}

func (s *Service) candidatesFor(ctx context.Context, q *dbgen.Queries,
	profile dbgen.RecipeDietProfile, slot, component string,
	maxMinutes *int32) ([]candidate, error) {

	rows, err := q.ListRecipeCandidates(ctx, dbgen.ListRecipeCandidatesParams{
		MealSlot:  slot,
		Component: component,
		// 过敏原与忌口在 SQL 里就滤掉，不留给上层——漏一层就是一次事故。
		ExcludeAllergens: cleanFilterList(profile.Allergens),
		Dislikes:         cleanFilterList(profile.Dislikes),
		MaxMinutes:       maxMinutes,
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make([]candidate, 0, len(rows))
	for _, row := range rows {
		out = append(out, candidateOf(row))
	}
	return out, nil
}

// cleanFilterList 规整过滤条件：去空白、丢掉空项、保证非 nil。
//
// 非 nil 是因为 Postgres 里 `x && NULL` 是 NULL 不是 false，
// 传 NULL 会让整个 WHERE 一条都不返回——症状是「菜单整周空白」。
//
// 丢空项是因为一个只剩空格的忌口项会被当成关键词去匹配菜名与食材，
// 把大量菜误伤掉。
func cleanFilterList(v []string) []string {
	out := make([]string, 0, len(v))
	for _, item := range v {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func appendOnce(notes []SuggestionNote, note SuggestionNote) []SuggestionNote {
	for _, existing := range notes {
		if existing.Kind == note.Kind && existing.MealSlot == note.MealSlot {
			return notes
		}
	}
	return append(notes, note)
}

// buildSuggestion 是选菜的全部逻辑，纯函数，不碰数据库。
func buildSuggestion(weekStart time.Time, seed int, goal string,
	target *EnergyTarget, all pools) Suggestion {

	out := Suggestion{
		WeekStart:   weekStart,
		Seed:        seed,
		Entries:     []SuggestedEntry{},
		Candidates:  map[string]int{},
		DailyTarget: target,
		Notes:       []SuggestionNote{},
	}
	for _, slot := range mealSlots {
		for _, list := range all[slot] {
			out.Candidates[slot] += len(list)
		}
	}

	// 整周不重样：一道菜在这一周里只出现一次，跨餐也算。
	// 午餐吃过的晚上再来一遍，用户会觉得这个功能没在干活。
	used := map[string]bool{}

	// 打分用的排名在整个池子上算一次，不必每天重算。
	ranks := map[string]map[string]float64{}
	for _, slot := range mealSlots {
		for component, list := range all[slot] {
			ranks[slot+"/"+component] = goalScores(list, goal, slot)
		}
	}

	unfilled := map[string]bool{}
	for day := 0; day < daysPerWeek; day++ {
		date := weekStart.AddDate(0, 0, day)
		for _, slot := range mealSlots {
			picks := buildMeal(all[slot], ranks, slot, seed, day, target, used)
			if len(picks) == 0 {
				unfilled[slot] = true
				continue
			}
			for _, pick := range picks {
				used[pick.ID] = true
				out.Entries = append(out.Entries, SuggestedEntry{
					Date: date, MealSlot: slot,
					RecipeID: pick.ID, Component: pick.Component,
				})
			}
		}
	}

	for _, slot := range mealSlots {
		if unfilled[slot] {
			out.Notes = append(out.Notes, SuggestionNote{
				Kind:     "slot_unfilled",
				MealSlot: slot,
				Message: fmt.Sprintf("按你的过敏原与忌口筛下来，没有可作为%s的菜，这几格留空了。",
					mealSlotLabel(slot)),
			})
		}
	}

	out.Achieved = achievedOf(out.Entries, all)
	if target != nil && target.Calories > 0 {
		gap := (out.Achieved.Calories - target.Calories) / target.Calories
		if gap > targetTolerance || gap < -targetTolerance {
			out.Notes = append(out.Notes, SuggestionNote{
				Kind: "target_unreachable",
				Message: fmt.Sprintf("符合你条件的菜凑不到每天 %.0f 千卡，这份菜单平均每天约 %.0f 千卡。",
					target.Calories, out.Achieved.Calories),
			})
		}
	}
	return out
}

// buildMeal 组出一餐。
//
// 主食那一格从 staple 与 one_dish 里一起挑；挑中 one_dish 时它顶掉
// 主食与荤菜两格，午晚只再配一道素菜。
func buildMeal(slotPools map[string][]candidate, ranks map[string]map[string]float64,
	slot string, seed, day int, target *EnergyTarget, used map[string]bool) []candidate {

	shape := mealShapes[slot]
	shares := componentShares[slot]
	mealCalories := 0.0
	if target != nil {
		mealCalories = target.Calories * slotShares[slot]
	}

	picks := make([]candidate, 0, len(shape))
	skipProtein := false

	for _, component := range shape {
		if component == "protein" && skipProtein {
			continue
		}
		// 主食那一格把 one_dish 也放进来一起比。
		pool := slotPools[component]
		if component == "staple" {
			pool = append(append([]candidate{}, pool...), slotPools["one_dish"]...)
		}
		pick, ok := choose(pool, ranks, slot, component, shares, mealCalories, seed, day, used)
		if !ok {
			continue
		}
		if pick.Component == "one_dish" {
			skipProtein = true
		}
		picks = append(picks, pick)
		// 同一餐里也不能重复，所以立刻标记。
		used[pick.ID] = true
	}
	return picks
}

// choose 从一个池子里挑一道。
func choose(pool []candidate, ranks map[string]map[string]float64,
	slot, component string, shares map[string]float64, mealCalories float64,
	seed, day int, used map[string]bool) (candidate, bool) {

	if len(pool) == 0 {
		return candidate{}, false
	}

	scored := make([]candidate, 0, len(pool))
	for _, c := range pool {
		if used[c.ID] {
			continue
		}
		scored = append(scored, c)
	}
	if len(scored) == 0 {
		return candidate{}, false
	}

	// 热量目标是**筛选条件**，不是打分项。
	//
	// 最初写成「契合度占 65% 权重」，然后在得分最高的 25 道里按 seed 随机。
	// 结果是每一格都偏高一点，三格一累加，目标 1400 排出来 2111——
	// 打分只表达倾向，挡不住偏差累积。改成先按目标框出一个热量带，
	// 带内再按营养质量挑，目标才真的起作用。
	if mealCalories > 0 {
		scored = withinCalorieBand(scored, shares, component, mealCalories)
	}

	sort.SliceStable(scored, func(i, j int) bool {
		si := ranks[slot+"/"+scored[i].Component][scored[i].ID]
		sj := ranks[slot+"/"+scored[j].Component][scored[j].ID]
		if si != sj {
			return si > sj
		}
		// 同分按 ID：排序必须是全序，否则同样的输入会给出不同的菜单。
		return scored[i].ID < scored[j].ID
	})
	if len(scored) > scorePoolSize {
		scored = scored[:scorePoolSize]
	}

	// 在好菜池里做确定性重排：同一个 seed 永远得到同一个顺序，
	// seed 变了顺序就变，于是「换一批」既能换出新东西又可复现。
	best := scored[0]
	bestKey := shuffleKey(seed, slot+component+fmt.Sprint(day), best.ID)
	for _, c := range scored[1:] {
		if key := shuffleKey(seed, slot+component+fmt.Sprint(day), c.ID); key < bestKey {
			best, bestKey = c, key
		}
	}
	return best, true
}

// achievedOf 算这份菜单的每日平均营养。
func achievedOf(entries []SuggestedEntry, all pools) Achieved {
	index := map[string]candidate{}
	for _, slotPools := range all {
		for _, list := range slotPools {
			for _, c := range list {
				index[c.ID] = c
			}
		}
	}

	var calories, protein, carbs, fat float64
	fatKnown := true
	for _, entry := range entries {
		c, ok := index[entry.RecipeID]
		if !ok {
			continue
		}
		calories += c.Calories
		protein += c.ProteinG
		carbs += c.CarbsG
		// 有一道菜缺脂肪，整周那一项就算不出来。
		// **不能把缺的当 0 加进去**：那样会给出一个偏低、
		// 且从数字本身看不出偏低的结果。
		if c.FatG == nil {
			fatKnown = false
		} else {
			fat += *c.FatG
		}
	}

	out := Achieved{
		Calories: roundTo(calories/daysPerWeek, 1),
		ProteinG: roundTo(protein/daysPerWeek, 1),
		CarbsG:   roundTo(carbs/daysPerWeek, 1),
	}
	if fatKnown && len(entries) > 0 {
		value := roundTo(fat/daysPerWeek, 1)
		out.FatG = &value
	}
	return out
}

// RecipeIDs 是建议里出现过的菜谱 ID，已去重。
func (s Suggestion) RecipeIDs() []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(s.Entries))
	for _, entry := range s.Entries {
		if seen[entry.RecipeID] {
			continue
		}
		seen[entry.RecipeID] = true
		out = append(out, entry.RecipeID)
	}
	return out
}

// RecipesByIDs 按 ID 取完整菜谱，用于把建议展开给客户端。
func (s *Service) RecipesByIDs(ctx context.Context, userID string, ids []string) (map[string]dbgen.Recipe, error) {
	out := map[string]dbgen.Recipe{}
	if len(ids) == 0 {
		return out, nil
	}
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListRecipesByIDs(ctx, ids)
		if err != nil {
			return apperr.Internal(err)
		}
		for _, row := range rows {
			out[row.ID] = row
		}
		return nil
	})
	return out, err
}

// shuffleKey 把 (seed, 位置, 菜谱 ID) 散列成一个排序键。
//
// 用散列而不是 math/rand：不依赖遍历顺序、不需要维护状态，
// 而且任何一次结果都能凭这三个输入重放出来。
func shuffleKey(seed int, position, id string) uint64 {
	h := fnv.New64a()
	fmt.Fprintf(h, "%d|%s|%s", seed, position, id)
	return h.Sum64()
}

// ---- 目标打分 ----

// goalScores 按目标契合度给池子里每道菜打一个 [0,1] 的分。
//
// 打分用**池内排名**而不是绝对阈值。导入内容的营养是按食材表估算的，
// 绝对值不可靠，但相对高低大体成立；而且「热量低于 400」这种阈值
// 换一批菜谱就得重调，排名不用。
func goalScores(pool []candidate, goal, slot string) map[string]float64 {
	if len(pool) == 0 {
		return map[string]float64{}
	}
	if len(pool) == 1 {
		return map[string]float64{pool[0].ID: 1}
	}

	cal := percentiles(pool, func(c candidate) float64 { return c.Calories })
	protein := percentiles(pool, func(c candidate) float64 { return c.ProteinG })
	density := percentiles(pool, func(c candidate) float64 {
		return c.ProteinG / max1(c.Calories)
	})
	carbShare := percentiles(pool, func(c candidate) float64 {
		return c.CarbsG * 4 / max1(c.Calories)
	})
	quick := percentiles(pool, func(c candidate) float64 { return -float64(c.Minutes) })

	out := make(map[string]float64, len(pool))
	for _, c := range pool {
		var s float64
		switch goal {
		case "fat_loss":
			// 比常规轻，但仍然是一顿饭。
			//
			// 这里刻意**不是**「热量越低越好」。那样打分会一路选到池子最底，
			// 实测平均每餐 114 kcal、一天三餐三百出头——那不是减脂食谱，
			// 是没法照着吃的东西。真正该拉开差距的是蛋白密度。
			s = 0.35*nearTarget(cal[c.ID], 0.30) + 0.50*density[c.ID] + 0.15*quick[c.ID]
		case "muscle_gain":
			s = 0.55*protein[c.ID] + 0.25*density[c.ID] + 0.20*nearTarget(cal[c.ID], 0.75)
		case "steady_sugar":
			s = 0.55*(1-carbShare[c.ID]) + 0.25*density[c.ID] + 0.20*nearTarget(cal[c.ID], 0.40)
		default:
			s = 0.60*nearTarget(cal[c.ID], 0.50) + 0.25*density[c.ID] + 0.15*quick[c.ID]
		}
		// 早餐额外看重快：早上没人愿意花四十分钟。
		if slot == "breakfast" {
			s = 0.75*s + 0.25*quick[c.ID]
		}
		out[c.ID] = s
	}
	return out
}

// percentiles 把一项指标换算成 [0,1] 的池内排名。
// 用排名而不是 z 分数：几条离谱的估算值不会把整池的分数压扁。
func percentiles(pool []candidate, valueOf func(candidate) float64) map[string]float64 {
	type entry struct {
		id    string
		value float64
	}
	entries := make([]entry, 0, len(pool))
	for _, c := range pool {
		entries = append(entries, entry{c.ID, valueOf(c)})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].value != entries[j].value {
			return entries[i].value < entries[j].value
		}
		return entries[i].id < entries[j].id
	})
	out := make(map[string]float64, len(entries))
	denom := float64(len(entries) - 1)
	// **相同的值必须拿到相同的排名。** 直接用下标当百分位的话，
	// 值一样的菜会按 ID 先后被分到不同名次——而 duration_minutes 是整数，
	// 库里几千道菜都正好 20 分钟，那样等于把「快」这一项变成了按 ID 抽签。
	// 并列的取名次区间的中点，这也是统计上百分位的通常算法。
	for i := 0; i < len(entries); {
		j := i
		for j+1 < len(entries) && entries[j+1].value == entries[i].value {
			j++
		}
		mid := float64(i+j) / 2 / denom
		for k := i; k <= j; k++ {
			out[entries[k].id] = mid
		}
		i = j + 1
	}
	return out
}

// nearTarget 把「离目标排名有多近」换算成 [0,1] 的得分：
// 正好在目标位置得 1，落在离目标最远的那一端得 0。
//
// 用它而不是单调的「越低越好」，是为了让目标有一个**落点**而不是一个方向。
// 单调打分永远选到池子的极端，而池子的极端往往是不合理的份量。
func nearTarget(p, target float64) float64 {
	span := target
	if 1-target > span {
		span = 1 - target
	}
	if span == 0 {
		return 1
	}
	return 1 - abs(p-target)/span
}

func max1(v float64) float64 {
	if v < 1 {
		return 1
	}
	return v
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

// withinCalorieBand 只留下热量落在目标附近的候选。
//
// 带宽从 ±25% 起，不够 minBandSize 道就逐步放宽。**放宽而不是放弃**：
// 一个都不留会让这一格空着，而排一道偏了 40% 的菜远好过不排。
// 一直放宽到全池都进来为止，所以这个函数永远不会返回空。
func withinCalorieBand(pool []candidate, shares map[string]float64,
	component string, mealCalories float64) []candidate {

	const minBandSize = 8
	for _, width := range []float64{0.25, 0.40, 0.60, 1.00} {
		kept := make([]candidate, 0, len(pool))
		for _, c := range pool {
			want := mealCalories * shares[c.Component]
			if want <= 0 {
				want = mealCalories * shares[component]
			}
			if want <= 0 {
				kept = append(kept, c)
				continue
			}
			if abs(c.Calories-want)/want <= width {
				kept = append(kept, c)
			}
		}
		if len(kept) >= minBandSize {
			return kept
		}
	}
	// 全都离目标很远。这一格只能将就，交给上层的 target_unreachable 说明。
	return pool
}
