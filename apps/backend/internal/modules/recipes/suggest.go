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
// 三类规则，优先级从高到低：
//
//  1. **过敏原与忌口**。任何情况下都不放宽。可选菜再少也宁可留空——
//     为了填满一周而放宽过敏原，是这个功能唯一能造成人身伤害的方式。
//  2. **一周不重样**。候选不够时才允许重复，且必须在 notes 里说出来。
//  3. **目标匹配**。按营养数字排名打分，是偏好不是硬条件。
//
// 全程确定性、不调用模型：同样的档案与 seed 必然得到同样的菜单。
// 这既是为了可测，也是为了「切走再切回来不换菜」——
// 用户看中的那道菜因为刷新消失了，比菜选得不够好更让人恼火。
//
// 生成结果不落库，用户点「采用本周菜单」后走 ConfirmMealPlan。

// mealSlots 是一天三餐的固定顺序，输出条目按此排列。
var mealSlots = []string{"breakfast", "lunch", "dinner"}

// daysPerWeek 是要填的天数。
const daysPerWeek = 7

// scorePoolSize 是进入随机化的「好菜池」大小。
//
// 只在打分最高的这些里随机：全池随机等于没打分，只取前 7 名则
// 「换一批」换不出东西来。40 道给 7 个格子，重排后仍有明显变化，
// 又不至于滑到池子尾部那些明显不合目标的菜。
const scorePoolSize = 40

// SuggestionNote 说明本次生成做了什么妥协。
type SuggestionNote struct {
	Kind     string
	Message  string
	MealSlot string
}

// SuggestedEntry 是建议里的一格。
type SuggestedEntry struct {
	Date     time.Time
	MealSlot string
	RecipeID string
}

// Suggestion 是一份未确认的周菜单。
type Suggestion struct {
	WeekStart  time.Time
	Seed       int
	Entries    []SuggestedEntry
	Candidates map[string]int
	Notes      []SuggestionNote
}

// candidate 是打分需要的全部信息。刻意不含食材与步骤：
// 候选集有几千行，带上 JSON 正文白白多出几十兆。
type candidate struct {
	ID         string
	Title      string
	Minutes    int
	Calories   float64
	ProteinG   float64
	CarbsG     float64
	Categories []string
}

func candidateOf(row dbgen.ListRecipeCandidatesRow) candidate {
	return candidate{
		ID:         row.ID,
		Title:      row.Title,
		Minutes:    int(row.DurationMinutes),
		Calories:   row.Calories,
		ProteinG:   row.ProteinG,
		CarbsG:     row.CarbsG,
		Categories: row.Categories,
	}
}

// SuggestMealPlan 按用户的饮食档案生成一周菜单建议。
func (s *Service) SuggestMealPlan(ctx context.Context, userID string,
	weekStart time.Time, seed int) (Suggestion, error) {

	profile, err := s.DietProfile(ctx, userID)
	if err != nil {
		return Suggestion{}, err
	}

	pools := map[string][]candidate{}
	var notes []SuggestionNote

	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, slot := range mealSlots {
			rows, err := s.candidatesForSlot(ctx, q, profile, slot, profile.MaxCookMinutes)
			if err != nil {
				return err
			}
			// 可选菜不够填满一周时，放宽「最长烹饪时间」再试一次。
			//
			// 时长是偏好，放宽了顶多让人多花十分钟，而且这里会明说；
			// 过敏原是安全条件，没有对应的放宽分支，将来也不要加。
			if len(rows) < daysPerWeek && profile.MaxCookMinutes != nil {
				relaxed, err := s.candidatesForSlot(ctx, q, profile, slot, nil)
				if err != nil {
					return err
				}
				if len(relaxed) > len(rows) {
					rows = relaxed
					notes = append(notes, SuggestionNote{
						Kind:     "cook_time_relaxed",
						MealSlot: slot,
						Message: fmt.Sprintf("%s能在 %d 分钟内做完的菜太少，这次放宽了时间限制。",
							mealSlotLabel(slot), *profile.MaxCookMinutes),
					})
				}
			}
			pools[slot] = rows
		}
		return nil
	})
	if err != nil {
		return Suggestion{}, err
	}

	out := buildSuggestion(weekStart, seed, string(profile.Goal), pools)
	out.Notes = append(notes, out.Notes...)
	return out, nil
}

func (s *Service) candidatesForSlot(ctx context.Context, q *dbgen.Queries,
	profile dbgen.RecipeDietProfile, slot string, maxMinutes *int32) ([]candidate, error) {

	rows, err := q.ListRecipeCandidates(ctx, dbgen.ListRecipeCandidatesParams{
		MealSlot: slot,
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
// 把大量菜误伤掉。SQL 里那道 `d <> ”` 拦不住 "  "。
func cleanFilterList(v []string) []string {
	out := make([]string, 0, len(v))
	for _, item := range v {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// buildSuggestion 是选菜的全部逻辑，纯函数，不碰数据库。
func buildSuggestion(weekStart time.Time, seed int, goal string,
	pools map[string][]candidate) Suggestion {

	out := Suggestion{
		WeekStart:  weekStart,
		Seed:       seed,
		Entries:    []SuggestedEntry{},
		Candidates: map[string]int{},
		Notes:      []SuggestionNote{},
	}

	// 整周不重样：一道菜在这一周里只出现一次，跨餐也算。
	// 午餐吃过的晚上再来一遍，用户会觉得这个功能没在干活。
	used := map[string]bool{}

	// 先按时段各自挑满一周，再按「日期 + 餐次」排出去。
	//
	// 时段按 breakfast → lunch → dinner 处理，而早餐池最小（库里约 940 道，
	// 午晚各 2600）。**最受限的先挑**：反过来的话，午晚餐会把早餐仅有的
	// 那些菜先占走，早餐反而排不出来。
	picks := map[string][]string{}
	for _, slot := range mealSlots {
		pool := pools[slot]
		out.Candidates[slot] = len(pool)
		chosen, note := pickWeek(pool, slot, seed, goal, used)
		picks[slot] = chosen
		if note != nil {
			out.Notes = append(out.Notes, *note)
		}
	}

	for day := 0; day < daysPerWeek; day++ {
		date := weekStart.AddDate(0, 0, day)
		for _, slot := range mealSlots {
			chosen := picks[slot]
			if day >= len(chosen) {
				continue
			}
			out.Entries = append(out.Entries, SuggestedEntry{
				Date: date, MealSlot: slot, RecipeID: chosen[day],
			})
		}
	}
	return out
}

// pickWeek 从一个时段的候选池里挑出一周的菜。
func pickWeek(pool []candidate, slot string, seed int, goal string,
	used map[string]bool) ([]string, *SuggestionNote) {

	if len(pool) == 0 {
		return nil, &SuggestionNote{
			Kind:     "slot_unfilled",
			MealSlot: slot,
			Message: fmt.Sprintf("按你的过敏原与忌口筛下来，没有可作为%s的菜，这一格留空了。",
				mealSlotLabel(slot)),
		}
	}

	ranked := rankByGoal(pool, goal, slot)
	if len(ranked) > scorePoolSize {
		ranked = ranked[:scorePoolSize]
	}
	// 在好菜池里做确定性重排：同一个 seed 永远得到同一个顺序，
	// seed 变了顺序就变，于是「换一批」既能换出新东西又可复现。
	sort.SliceStable(ranked, func(i, j int) bool {
		return shuffleKey(seed, slot, ranked[i].ID) < shuffleKey(seed, slot, ranked[j].ID)
	})

	chosen := make([]string, 0, daysPerWeek)
	var lastCategory string
	for pass := 0; pass < 2 && len(chosen) < daysPerWeek; pass++ {
		for _, item := range ranked {
			if len(chosen) >= daysPerWeek {
				break
			}
			if used[item.ID] {
				continue
			}
			// 第一轮避开与前一天同品类；不够了第二轮就不挑了。
			// 这是「别连着三天都是炒菜」，不是硬条件。
			if pass == 0 && lastCategory != "" && primaryCategory(item) == lastCategory {
				continue
			}
			chosen = append(chosen, item.ID)
			used[item.ID] = true
			lastCategory = primaryCategory(item)
		}
	}

	if len(chosen) >= daysPerWeek {
		return chosen, nil
	}

	// 候选实在不够一周。重复排总比留空好——用户能自己换掉重的那几格，
	// 但空格子只会让人以为功能坏了。重复了就说出来。
	if len(chosen) == 0 {
		// 池子里的菜全被别的时段用光了，只能允许跨时段重复。
		chosen = append(chosen, ranked[0].ID)
	}
	filled := len(chosen)
	for i := filled; i < daysPerWeek; i++ {
		chosen = append(chosen, chosen[i%filled])
	}
	return chosen, &SuggestionNote{
		Kind:     "pool_repeats",
		MealSlot: slot,
		// 报的是池子大小而不是实际填进去的道数：用户能据此判断
		// 「是我筛得太狠」，而实际道数还受别的时段占用影响，说不清楚。
		Message: fmt.Sprintf("符合条件的%s只有 %d 道，不够一周，有几天是重复的。",
			mealSlotLabel(slot), len(pool)),
	}
}

// primaryCategory 取第一个品类作为「这是哪一类菜」。
func primaryCategory(c candidate) string {
	if len(c.Categories) == 0 {
		return ""
	}
	return c.Categories[0]
}

// shuffleKey 把 (seed, 时段, 菜谱 ID) 散列成一个排序键。
//
// 用散列而不是 math/rand：不依赖遍历顺序、不需要维护状态，
// 而且任何一次结果都能凭这三个输入重放出来。
func shuffleKey(seed int, slot, id string) uint64 {
	h := fnv.New64a()
	fmt.Fprintf(h, "%d|%s|%s", seed, slot, id)
	return h.Sum64()
}

// ---- 打分 ----

// rankByGoal 按目标契合度从高到低排序。
//
// 打分用**池内排名**而不是绝对阈值。导入内容的营养是按食材表估算的，
// 绝对值不可靠，但相对高低大体成立；而且「热量低于 400」这种阈值
// 换一批菜谱就得重调，排名不用。
func rankByGoal(pool []candidate, goal, slot string) []candidate {
	if len(pool) <= 1 {
		return append([]candidate{}, pool...)
	}

	cal := percentiles(pool, func(c candidate) float64 { return c.Calories })
	protein := percentiles(pool, func(c candidate) float64 { return c.ProteinG })
	density := percentiles(pool, func(c candidate) float64 {
		return c.ProteinG / max1(c.Calories)
	})
	carbShare := percentiles(pool, func(c candidate) float64 {
		return c.CarbsG * 4 / max1(c.Calories)
	})
	// 时间越短排名越高。
	quick := percentiles(pool, func(c candidate) float64 { return -float64(c.Minutes) })

	scores := make(map[string]float64, len(pool))
	for _, c := range pool {
		var s float64
		switch goal {
		case "fat_loss":
			// 比常规轻，但仍然是一顿饭。
			//
			// 这里刻意**不是**「热量越低越好」。那样打分会一路选到池子最底，
			// 实测平均每餐 114 kcal、一天三餐三百出头——那不是减脂食谱，
			// 是没法照着吃的东西。真正该拉开差距的是蛋白密度：
			// 同样的热量给到更多蛋白，才是减脂时想要的。
			s = 0.35*nearTarget(cal[c.ID], 0.30) + 0.50*density[c.ID] + 0.15*quick[c.ID]
		case "muscle_gain":
			// 蛋白绝对量优先。热量偏高没关系，但同样不取最极端的那批。
			s = 0.55*protein[c.ID] + 0.25*density[c.ID] + 0.20*nearTarget(cal[c.ID], 0.75)
		case "steady_sugar":
			// 碳水供能占比低，份量仍然正常。
			s = 0.55*(1-carbShare[c.ID]) + 0.25*density[c.ID] + 0.20*nearTarget(cal[c.ID], 0.40)
		default:
			// balanced：避开两头极端，居中的得分最高。
			s = 0.60*nearTarget(cal[c.ID], 0.50) + 0.25*density[c.ID] + 0.15*quick[c.ID]
		}
		// 早餐额外看重快：早上没人愿意花四十分钟。
		if slot == "breakfast" {
			s = 0.75*s + 0.25*quick[c.ID]
		}
		scores[c.ID] = s
	}

	out := append([]candidate{}, pool...)
	sort.SliceStable(out, func(i, j int) bool {
		if scores[out[i].ID] != scores[out[j].ID] {
			return scores[out[i].ID] > scores[out[j].ID]
		}
		// 同分按 ID：排序必须是全序，否则同样的输入会给出不同的菜单。
		return out[i].ID < out[j].ID
	})
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
