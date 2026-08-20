package recipes

import (
	"math"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

// 每日热量与宏量目标的测试。
//
// 这里守的是两件事：算得对，以及**算不出来时不要瞎猜**。
// 后者更要紧——一个编出来的默认体重会给出看起来很确定、
// 但对这个人是错的数字。

func profileOf(goal string, age int32, sex string, height, weight float64,
	activity string) dbgen.RecipeDietProfile {

	return dbgen.RecipeDietProfile{
		Goal:          goal,
		Age:           &age,
		Sex:           sex,
		HeightCm:      &height,
		WeightKg:      &weight,
		ActivityLevel: activity,
	}
}

func TestDailyEnergyTargetMatchesMifflinStJeor(t *testing.T) {
	// 男，30 岁，175cm，70kg，轻度活动，均衡。
	// BMR = 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75
	// TDEE = 1648.75 * 1.375 = 2267.03 → 取整到 50 → 2250
	got, ok := DailyEnergyTarget(profileOf("balanced", 30, "male", 175, 70, "light"))
	if !ok {
		t.Fatal("身体数据齐全，应当算得出来")
	}
	if got.Calories != 2250 {
		t.Errorf("每日热量应当是 2250，实际 %.0f", got.Calories)
	}
	// 均衡 50/20/30：碳 281g、蛋 112.5g、脂 75g。
	// 蛋白按体重下限是 70*1.2 = 84g，比 112.5 小，所以用占比那个。
	if math.Abs(got.ProteinG-112.5) > 1 {
		t.Errorf("蛋白应当约 112.5g，实际 %.1f", got.ProteinG)
	}
	if math.Abs(got.FatG-75) > 1 {
		t.Errorf("脂肪应当约 75g，实际 %.1f", got.FatG)
	}
	if len(got.Notes) != 0 {
		t.Errorf("数据齐全且没夹下限，不该有说明：%+v", got.Notes)
	}
}

func TestDailyEnergyTargetAppliesGoalAdjustment(t *testing.T) {
	base, _ := DailyEnergyTarget(profileOf("balanced", 30, "male", 175, 70, "light"))
	cut, _ := DailyEnergyTarget(profileOf("fat_loss", 30, "male", 175, 70, "light"))
	bulk, _ := DailyEnergyTarget(profileOf("muscle_gain", 30, "male", 175, 70, "light"))

	if cut.Calories >= base.Calories {
		t.Errorf("减脂应当低于均衡：%.0f vs %.0f", cut.Calories, base.Calories)
	}
	if bulk.Calories <= base.Calories {
		t.Errorf("增肌应当高于均衡：%.0f vs %.0f", bulk.Calories, base.Calories)
	}
	// 用百分比而不是固定千卡：缺口应当随基数缩放。
	ratio := cut.Calories / base.Calories
	if math.Abs(ratio-0.80) > 0.02 {
		t.Errorf("减脂缺口应当是 20%% 左右，实际比值 %.3f", ratio)
	}
}

// 热量下限是硬的。
//
// 一个身材娇小、久坐的人按减脂 −20% 算会落到一千出头，
// 再低就不是「吃得少」而是「吃不够」。夹住，并且必须说出来——
// 悄悄夹会让用户以为这就是按他的数据算出来的结果。
func TestDailyEnergyTargetEnforcesFloor(t *testing.T) {
	got, ok := DailyEnergyTarget(profileOf("fat_loss", 55, "female", 150, 45, "sedentary"))
	if !ok {
		t.Fatal("应当算得出来")
	}
	if got.Calories < floorCaloriesFemale {
		t.Errorf("不得低于 %.0f，实际 %.0f", floorCaloriesFemale, got.Calories)
	}
	found := false
	for _, n := range got.Notes {
		if n.Kind == "energy_floored" {
			found = true
		}
	}
	if !found {
		t.Errorf("夹到下限必须说明，实际 %+v", got.Notes)
	}
}

// 身体数据缺任何一项就算不出来，**不能拿默认值顶上**。
func TestDailyEnergyTargetRefusesIncompleteProfile(t *testing.T) {
	full := profileOf("balanced", 30, "male", 175, 70, "light")

	cases := map[string]func(p *dbgen.RecipeDietProfile){
		"没填年龄": func(p *dbgen.RecipeDietProfile) { p.Age = nil },
		"没填身高": func(p *dbgen.RecipeDietProfile) { p.HeightCm = nil },
		"没填体重": func(p *dbgen.RecipeDietProfile) { p.WeightKg = nil },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p := full
			mutate(&p)
			if _, ok := DailyEnergyTarget(p); ok {
				t.Error("数据不全时应当返回 false，让调用方退回排名打分")
			}
		})
	}

	// 填了但是 0 也算没填：客户端把空输入提交成 0 是常见的。
	zero := 0.0
	p := full
	p.WeightKg = &zero
	if _, ok := DailyEnergyTarget(p); ok {
		t.Error("体重为 0 应当当作没填")
	}
}

// 性别没填不该让整个功能用不了，取中点并说明精度。
func TestDailyEnergyTargetHandlesUnspecifiedSex(t *testing.T) {
	male, _ := DailyEnergyTarget(profileOf("balanced", 30, "male", 175, 70, "light"))
	female, _ := DailyEnergyTarget(profileOf("balanced", 30, "female", 175, 70, "light"))
	unknown, ok := DailyEnergyTarget(profileOf("balanced", 30, "unspecified", 175, 70, "light"))
	if !ok {
		t.Fatal("性别没填不该让整个计算失效")
	}
	if unknown.Calories <= female.Calories || unknown.Calories >= male.Calories {
		t.Errorf("应当落在男女之间：女 %.0f，未填 %.0f，男 %.0f",
			female.Calories, unknown.Calories, male.Calories)
	}
	found := false
	for _, n := range unknown.Notes {
		if n.Kind == "energy_estimated" {
			found = true
		}
	}
	if !found {
		t.Errorf("按中点估算必须说明，实际 %+v", unknown.Notes)
	}
}

func TestDailyEnergyTargetScalesWithActivity(t *testing.T) {
	var last float64
	for _, level := range []string{"sedentary", "light", "moderate", "active"} {
		got, _ := DailyEnergyTarget(profileOf("balanced", 30, "male", 175, 70, level))
		if got.Calories <= last {
			t.Errorf("%s 应当高于上一档：%.0f vs %.0f", level, got.Calories, last)
		}
		last = got.Calories
	}
}

// 低热量下蛋白不能被供能占比压下去——减脂时这恰恰是最不该省的。
func TestDailyEnergyTargetKeepsProteinFloor(t *testing.T) {
	// 体重 80kg 的人减脂：按占比算蛋白 = 热量*0.30/4，
	// 若热量被夹到下限，占比给出的蛋白会低于 80*1.6=128g。
	got, ok := DailyEnergyTarget(profileOf("fat_loss", 60, "female", 155, 80, "sedentary"))
	if !ok {
		t.Fatal("应当算得出来")
	}
	if got.ProteinG < 80*1.6-1 {
		t.Errorf("蛋白应当不低于按体重的下限 128g，实际 %.1f", got.ProteinG)
	}
	// 三大宏量的热量之和不能超过总目标，否则报出去的数字自相矛盾。
	sum := got.ProteinG*4 + got.CarbsG*4 + got.FatG*9
	if sum > got.Calories+5 {
		t.Errorf("碳蛋脂折算热量 %.0f 超过了每日目标 %.0f", sum, got.Calories)
	}
}

func TestSlotSharesCoverWholeDay(t *testing.T) {
	var total float64
	for _, slot := range mealSlots {
		total += slotShares[slot]
	}
	if math.Abs(total-1.0) > 0.001 {
		t.Errorf("三餐占比之和应当是 1，实际 %.3f", total)
	}
}
