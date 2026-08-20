package recipes

import (
	"encoding/json"
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// 这些是确定性规则，不需要数据库：合并份量、校验一周之内、一格一道菜。
// 归属隔离由 RLS 保证，那部分在 platform/database/rls_test.go。

func TestMergeIngredientsCombinesAcrossRecipes(t *testing.T) {
	entries := []dbgen.ListMealPlanEntriesRow{
		recipeEntry(t, "rcp_a", ingredient{"鸡蛋", "protein", "2 个"}, ingredient{"盐", "seasoning", "适量"}),
		recipeEntry(t, "rcp_b", ingredient{"鸡蛋", "protein", "3 个"}, ingredient{"番茄", "produce", "2 个"}),
	}

	items := mergeIngredients(entries)

	byName := map[string]ShoppingItem{}
	for _, item := range items {
		byName[item.Name] = item
	}

	egg, ok := byName["鸡蛋"]
	if !ok {
		t.Fatal("鸡蛋应当出现在合并结果里")
	}
	// 两道菜都要鸡蛋，来源要能同时指回去。
	if len(egg.RecipeIDs) != 2 {
		t.Errorf("鸡蛋应当来自 2 道菜，实际 %v", egg.RecipeIDs)
	}
	// 份量并列而不是求和：单位不一定能加。
	if egg.Quantity != "2 个 + 3 个" {
		t.Errorf("份量应当并列，实际 %q", egg.Quantity)
	}
	if len(byName) != 3 {
		t.Errorf("应当合并成 3 项，实际 %d 项", len(byName))
	}
}

func TestMergeIngredientsKeepsUnaddableQuantitiesSeparate(t *testing.T) {
	// 「2 个」加「少许」算不出一个准确总量，硬凑一个数反而误导。
	entries := []dbgen.ListMealPlanEntriesRow{
		recipeEntry(t, "rcp_a", ingredient{"蒜", "produce", "2 瓣"}),
		recipeEntry(t, "rcp_b", ingredient{"蒜", "produce", "少许"}),
	}

	items := mergeIngredients(entries)
	if len(items) != 1 {
		t.Fatalf("应当合并成 1 项，实际 %d 项", len(items))
	}
	if items[0].Quantity != "2 瓣 + 少许" {
		t.Errorf("不可相加的份量应当原样并列，实际 %q", items[0].Quantity)
	}
}

func TestMergeIngredientsGroupsForShopping(t *testing.T) {
	// 购物时同类挨在一起：蔬果、蛋白、主食、调味。
	entries := []dbgen.ListMealPlanEntriesRow{
		recipeEntry(t, "rcp_a",
			ingredient{"酱油", "seasoning", "1 勺"},
			ingredient{"米饭", "staple", "1 碗"},
			ingredient{"青菜", "produce", "200 克"},
			ingredient{"豆腐", "protein", "1 盒"},
		),
	}

	items := mergeIngredients(entries)
	got := make([]string, 0, len(items))
	for _, item := range items {
		got = append(got, item.Group)
	}
	want := []string{"produce", "protein", "staple", "seasoning"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("分组顺序应当是 %v，实际 %v", want, got)
		}
	}
}

func TestValidateMealPlanEntriesRejectsDateOutsideWeek(t *testing.T) {
	weekStart := date(t, "2026-08-17")
	err := validateMealPlanEntries(weekStart, []httpapi.MealPlanEntryInput{
		{Date: openapi_types.Date{Time: date(t, "2026-08-24")}, MealSlot: "lunch", RecipeId: "rcp_a"},
	})
	assertValidationFailed(t, err)
}

func TestValidateMealPlanEntriesAcceptsWholeWeek(t *testing.T) {
	weekStart := date(t, "2026-08-17")
	// 周一到周日都算这一周，第八天不算。
	for _, day := range []string{"2026-08-17", "2026-08-20", "2026-08-23"} {
		if err := validateMealPlanEntries(weekStart, []httpapi.MealPlanEntryInput{
			{Date: openapi_types.Date{Time: date(t, day)}, MealSlot: "lunch", RecipeId: "rcp_a"},
		}); err != nil {
			t.Errorf("%s 应当在这一周内，却被拒：%v", day, err)
		}
	}
}

func TestValidateMealPlanEntriesRejectsDuplicateSlot(t *testing.T) {
	weekStart := date(t, "2026-08-17")
	err := validateMealPlanEntries(weekStart, []httpapi.MealPlanEntryInput{
		{Date: openapi_types.Date{Time: weekStart}, MealSlot: "lunch", RecipeId: "rcp_a"},
		{Date: openapi_types.Date{Time: weekStart}, MealSlot: "lunch", RecipeId: "rcp_b"},
	})
	assertValidationFailed(t, err)
}

func TestValidateDietProfileRejectsOutOfRangeBody(t *testing.T) {
	age := 200
	if err := validateDietProfile(httpapi.UpdateDietProfileRequest{Age: &age}); err == nil {
		t.Error("200 岁应当被拒")
	}
	weight := 5.0
	if err := validateDietProfile(httpapi.UpdateDietProfileRequest{WeightKg: &weight}); err == nil {
		t.Error("5 公斤应当被拒")
	}
	// 合理值要放行，别把校验写成一刀切。
	okAge, okWeight := 34, 76.5
	if err := validateDietProfile(httpapi.UpdateDietProfileRequest{
		Age: &okAge, WeightKg: &okWeight,
	}); err != nil {
		t.Errorf("正常身体数据不该被拒：%v", err)
	}
}

func TestPlannedNutritionSumsWholeWeek(t *testing.T) {
	entries := []dbgen.ListMealPlanEntriesRow{
		{Recipe: dbgen.Recipe{Calories: 300, ProteinG: 20, CarbsG: 30, FiberG: 5}},
		{Recipe: dbgen.Recipe{Calories: 450, ProteinG: 25, CarbsG: 55, FiberG: 8}},
	}
	got := PlannedNutrition(entries)
	if got.Calories != 750 || got.ProteinG != 45 || got.CarbsG != 85 || got.FiberG != 13 {
		t.Errorf("整周求和不对：%+v", got)
	}
}

// ---- 辅助 ----

type ingredient struct{ name, group, amount string }

func recipeEntry(t *testing.T, recipeID string, ingredients ...ingredient) dbgen.ListMealPlanEntriesRow {
	t.Helper()
	items := make([]httpapi.RecipeIngredient, 0, len(ingredients))
	for _, in := range ingredients {
		items = append(items, httpapi.RecipeIngredient{
			Name: in.name, Group: httpapi.RecipeIngredientGroup(in.group), Amount: in.amount,
		})
	}
	raw, err := json.Marshal(items)
	if err != nil {
		t.Fatalf("编码食材失败：%v", err)
	}
	return dbgen.ListMealPlanEntriesRow{
		Recipe: dbgen.Recipe{ID: recipeID, Ingredients: raw},
	}
}

func date(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatalf("解析日期失败：%v", err)
	}
	return parsed
}

func assertValidationFailed(t *testing.T, err error) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Code != apperr.CodeValidationFailed {
		t.Fatalf("期望 VALIDATION_FAILED，实际 %v", err)
	}
}
