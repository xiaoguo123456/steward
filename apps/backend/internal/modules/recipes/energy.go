package recipes

import (
	"fmt"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

// 每日热量与碳蛋脂目标。
//
// 全是纯函数，输入只有用户自己填的饮食档案。**不接受模型推断的身体数据**：
// 身高体重属高敏信息，能力层没有登记对应 Capability，这里也不该有后门。
//
// 这套数字是一般性的能量估算，不是治疗方案。规格 8.2 明确写了控糖目标
// 不提供疾病诊断、治疗承诺或用药建议，这里的下限与措辞都要守住那条线。

// EnergyTarget 是算出来的每日目标。
type EnergyTarget struct {
	// Calories 是每日热量目标，已取整到 50 kcal。
	Calories float64
	// ProteinG / CarbsG / FatG 是三大宏量的克数目标。
	ProteinG float64
	CarbsG   float64
	FatG     float64
	// Notes 说明算的过程中做了什么处理（夹到下限、性别没填等）。
	Notes []SuggestionNote
}

// 活动系数。名字对应契约里的 DietActivityLevel。
var activityFactors = map[string]float64{
	"sedentary": 1.2,
	"light":     1.375,
	"moderate":  1.55,
	"active":    1.725,
}

// 目标对每日热量的调整。
//
// 用**百分比**而不是固定的 500 kcal 缺口：固定值对体重轻的人比例上过狠，
// 45 公斤的人减 500 kcal 和 90 公斤的人减 500 kcal 完全不是一回事。
var goalAdjust = map[string]float64{
	"fat_loss":     0.80,
	"muscle_gain":  1.10,
	"steady_sugar": 1.00,
	"balanced":     1.00,
}

// 每日热量下限。**这是硬的，任何计算结果都不许低于它。**
//
// 减脂按 −20% 算，对一个身材娇小、久坐的人可能落到一千出头；
// 再低就不是「吃得少」而是「吃不够」了。夹住并明确告诉用户。
const (
	floorCaloriesFemale = 1200.0
	floorCaloriesMale   = 1500.0
	// 性别没填时取两者中间，和 BMR 那里的处理保持一致。
	floorCaloriesUnknown = 1350.0
)

// 碳蛋脂供能占比。
var macroSplits = map[string][3]float64{
	// 碳、蛋、脂
	"balanced":     {0.50, 0.20, 0.30},
	"fat_loss":     {0.35, 0.30, 0.35},
	"muscle_gain":  {0.45, 0.30, 0.25},
	"steady_sugar": {0.40, 0.25, 0.35},
}

// 按体重的蛋白下限（g/kg）。
//
// 只按供能占比算，在低热量下蛋白会被压得太低——减脂时这恰恰是最不该省的。
// 两者取大。
var proteinFloorPerKg = map[string]float64{
	"fat_loss":     1.6,
	"muscle_gain":  1.6,
	"balanced":     1.2,
	"steady_sugar": 1.2,
}

// DailyEnergyTarget 按饮食档案算出每日热量与宏量目标。
//
// 第二个返回值为 false 表示**算不出来**：身高、体重、年龄有任何一项没填，
// 就没有可靠的基础代谢。这时调用方退回按排名打分，
// **绝不用一个默认体重顶上**——编一个 60 公斤会给出一个看起来很确定、
// 但对这个人是错的数字，比明说「算不了」糟得多。
func DailyEnergyTarget(profile dbgen.RecipeDietProfile) (EnergyTarget, bool) {
	if profile.HeightCm == nil || profile.WeightKg == nil || profile.Age == nil {
		return EnergyTarget{}, false
	}
	height, weight, age := *profile.HeightCm, *profile.WeightKg, float64(*profile.Age)
	if height <= 0 || weight <= 0 || age <= 0 {
		return EnergyTarget{}, false
	}

	goal := string(profile.Goal)
	sex := sexOf(profile)
	var notes []SuggestionNote

	// Mifflin-St Jeor。比 Harris-Benedict 更贴现代人群，是目前的通用式。
	bmr := 10*weight + 6.25*height - 5*age
	switch sex {
	case "male":
		bmr += 5
	case "female":
		bmr -= 161
	default:
		// 没填性别就取男女公式的中点。两式只差 166 kcal，中点最多偏 83——
		// 比要求用户必须填性别才能用这个功能要好。
		bmr += 5 - 166.0/2
		notes = append(notes, SuggestionNote{
			Kind:    "energy_estimated",
			Message: "你没有填性别，热量目标按中间值估算，可能有几十千卡的出入。",
		})
	}

	factor, ok := activityFactors[string(profile.ActivityLevel)]
	if !ok {
		factor = activityFactors["light"]
	}
	calories := bmr * factor * adjustOr(goal)

	if floor := floorFor(sex); calories < floor {
		notes = append(notes, SuggestionNote{
			Kind: "energy_floored",
			Message: fmt.Sprintf(
				"按你的身体数据和目标算出来低于 %.0f 千卡，已按 %.0f 千卡安排——再低就不是吃得少而是吃不够了。",
				floor, floor),
		})
		calories = floor
	}

	// 取整到 50 kcal。数据精度撑不起更细的说法：菜谱营养是按食材表估算的，
	// 报一个 1783 会让人以为这个数字比实际可靠。
	calories = roundTo(calories, 50)

	split := macroSplits[goal]
	if split == [3]float64{} {
		split = macroSplits["balanced"]
	}
	protein := calories * split[1] / 4
	if floor := weight * proteinFloorPerKg[goal]; floor > protein {
		protein = floor
	}
	// 蛋白被下限顶上去之后，碳水要让出对应的热量，否则总量对不上。
	remaining := calories - protein*4
	fat := calories * split[2] / 9
	carbs := (remaining - fat*9) / 4
	if carbs < 0 {
		carbs = 0
	}

	return EnergyTarget{
		Calories: calories,
		ProteinG: roundTo(protein, 1),
		CarbsG:   roundTo(carbs, 1),
		FatG:     roundTo(fat, 1),
		Notes:    notes,
	}, true
}

func sexOf(profile dbgen.RecipeDietProfile) string {
	if profile.Sex == "" {
		return "unspecified"
	}
	return string(profile.Sex)
}

func floorFor(sex string) float64 {
	switch sex {
	case "male":
		return floorCaloriesMale
	case "female":
		return floorCaloriesFemale
	default:
		return floorCaloriesUnknown
	}
}

func adjustOr(goal string) float64 {
	if v, ok := goalAdjust[goal]; ok {
		return v
	}
	return 1.0
}

// 餐次热量分配。
//
// 取自中国居民膳食指南的建议区间（早 25–30%、午 30–40%、晚 30–35%）。
// **午晚的结构一样，差距放在份量上**：用道数区分会让晚餐显得寒酸，
// 而中国人的晚餐通常不比午餐简单。
var slotShares = map[string]float64{
	"breakfast": 0.25,
	"lunch":     0.40,
	"dinner":    0.35,
}

func roundTo(v, unit float64) float64 {
	if unit <= 0 {
		return v
	}
	return float64(int(v/unit+0.5)) * unit
}
