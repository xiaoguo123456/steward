package recipes

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 用户在食谱场景里自己的数据：饮食档案、收藏、做过、本周菜单。
//
// 菜谱本身是共享的只读内容；这里的每一样都属于某个人，全部受 RLS 约束。

// UserProfile 是本模块需要的用户信息，由 bootstrap 注入。
//
// 只声明用得到的两个方法：周从哪天开始是用户偏好，时区决定「今天」是哪天。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
	Preferences(ctx context.Context, userID string) (dbgen.UserPreference, error)
}

// ---- 饮食档案 ----

// DietProfile 读取饮食档案。
//
// 从没填过问卷时返回一份默认档案而不是 404：客户端要的是
// 「现在按什么口径推荐」，不是「有没有这行记录」。
func (s *Service) DietProfile(ctx context.Context, userID string) (dbgen.RecipeDietProfile, error) {
	var out dbgen.RecipeDietProfile
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetDietProfile(ctx, userID)
		if err != nil {
			if database.IsNoRows(err) {
				out = defaultDietProfile(userID)
				return nil
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// defaultDietProfile 是没填问卷时的口径。
//
// 取值必须和迁移里的 DEFAULT 一致，否则「填之前」和「填完又清空」
// 会得到两种不同的推荐结果。
func defaultDietProfile(userID string) dbgen.RecipeDietProfile {
	return dbgen.RecipeDietProfile{
		UserID:        userID,
		Goal:          "balanced",
		Sex:           "unspecified",
		ActivityLevel: "moderate",
		Allergens:     []string{},
		Dislikes:      []string{},
		Servings:      2,
		Completed:     false,
		Budget:        "standard",
		Tastes:        []string{},
		Equipment:     []string{},
		UpdatedAt:     time.Now(),
	}
}

// UpdateDietProfile 修改饮食档案。
//
// 身体数据只允许用户自己填写与修改；这个方法没有任何「由推断结果调用」的入口，
// AI 能力层也没有登记对应的 Capability。
func (s *Service) UpdateDietProfile(ctx context.Context, userID string,
	body httpapi.UpdateDietProfileRequest) (dbgen.RecipeDietProfile, error) {

	if err := validateDietProfile(body); err != nil {
		return dbgen.RecipeDietProfile{}, err
	}
	clear := dietClearFlagsOf(body.Clear)

	var out dbgen.RecipeDietProfile
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.UpsertDietProfile(ctx, dbgen.UpsertDietProfileParams{
			UserID:            userID,
			Goal:              stringPtrOf(body.Goal),
			Sex:               stringPtrOf(body.Sex),
			ActivityLevel:     stringPtrOf(body.ActivityLevel),
			Age:               int32PtrOf(body.Age),
			ClearAge:          clear.Age,
			HeightCm:          body.HeightCm,
			ClearHeight:       clear.Height,
			WeightKg:          body.WeightKg,
			ClearWeight:       clear.Weight,
			TargetWeightKg:    body.TargetWeightKg,
			ClearTargetWeight: clear.TargetWeight,
			MaxCookMinutes:    int32PtrOf(body.MaxCookMinutes),
			ClearCookMinutes:  clear.CookMinutes,
			Allergens:         trimmedList(body.Allergens),
			Dislikes:          trimmedList(body.Dislikes),
			Servings:          int32PtrOf(body.Servings),
			Completed:         body.Completed,
			Budget:            stringPtrOf(body.Budget),
			Tastes:            trimmedList(body.Tastes),
			Equipment:         trimmedList(body.Equipment),
			// 疾病自述只接受用户明确勾选，服务端不做任何推断。
			DiagnosedCondition: body.DiagnosedCondition,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// validateDietProfile 在写库之前拦住明显不合理的输入。
//
// 库上有 CHECK 兜底，但那报出来的是约束名，用户看不懂；
// 这里给的是能直接读的字段说明。
func validateDietProfile(body httpapi.UpdateDietProfileRequest) error {
	if body.Age != nil && (*body.Age < 1 || *body.Age > 120) {
		return apperr.Validation(apperr.Field("age", "年龄请填 1 到 120 之间。"))
	}
	if body.HeightCm != nil && (*body.HeightCm < 50 || *body.HeightCm > 260) {
		return apperr.Validation(apperr.Field("height_cm", "身高请填 50 到 260 厘米之间。"))
	}
	for field, value := range map[string]*float64{
		"weight_kg": body.WeightKg, "target_weight_kg": body.TargetWeightKg,
	} {
		if value != nil && (*value < 20 || *value > 400) {
			return apperr.Validation(apperr.Field(field, "体重请填 20 到 400 公斤之间。"))
		}
	}
	if body.Servings != nil && (*body.Servings < 1 || *body.Servings > 20) {
		return apperr.Validation(apperr.Field("servings", "用餐人数请填 1 到 20 之间。"))
	}
	if body.MaxCookMinutes != nil && *body.MaxCookMinutes <= 0 {
		return apperr.Validation(apperr.Field("max_cook_minutes", "烹饪时间要大于 0。"))
	}
	return nil
}

type dietClearFlags struct{ Age, Height, Weight, TargetWeight, CookMinutes bool }

func dietClearFlagsOf(fields *[]httpapi.UpdateDietProfileRequestClear) dietClearFlags {
	var out dietClearFlags
	if fields == nil {
		return out
	}
	for _, field := range *fields {
		switch field {
		case "age":
			out.Age = true
		case "height_cm":
			out.Height = true
		case "weight_kg":
			out.Weight = true
		case "target_weight_kg":
			out.TargetWeight = true
		case "max_cook_minutes":
			out.CookMinutes = true
		}
	}
	return out
}

// ---- 收藏与做过 ----

// ListFavorites 查询收藏的菜谱。
func (s *Service) ListFavorites(ctx context.Context, userID string, limit int32) ([]dbgen.Recipe, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var out []dbgen.Recipe
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListFavoriteRecipes(ctx, limit)
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// SetFavorite 收藏或取消收藏。
func (s *Service) SetFavorite(ctx context.Context, userID, recipeID string, favorite bool) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// 先确认菜谱存在：收藏一个不存在的 ID 应当是 404，
		// 而不是静静地留下一条指向空气的收藏。
		if _, err := q.GetRecipe(ctx, recipeID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("菜谱")
			}
			return apperr.Internal(err)
		}
		if !favorite {
			if err := q.UnfavoriteRecipe(ctx, recipeID); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		if err := q.FavoriteRecipe(ctx, dbgen.FavoriteRecipeParams{
			ID: idgen.New(idgen.PrefixRecipeFavorite), UserID: userID, RecipeID: recipeID,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// MarkCooked 记一次「做过」。
//
// 它不等于记录实际摄入：后者是 Record，走记录项接口。
func (s *Service) MarkCooked(ctx context.Context, userID, recipeID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetRecipe(ctx, recipeID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("菜谱")
			}
			return apperr.Internal(err)
		}
		if err := q.CreateCookLog(ctx, dbgen.CreateCookLogParams{
			ID: idgen.New(idgen.PrefixRecipeCookLog), UserID: userID,
			RecipeID: recipeID, CookedAt: time.Now(),
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// ---- 本周菜单 ----

// MealPlan 是一份已确认的菜单及其条目。
type MealPlan struct {
	Row     dbgen.MealPlan
	Entries []dbgen.ListMealPlanEntriesRow
}

// WeekStartFor 算出某个日期所在周的第一天。
//
// 周一还是周日开始是用户偏好，「今天」是哪天取决于用户时区——
// 两者都只有服务端知道，所以客户端不自行推导，也不需要传。
func (s *Service) WeekStartFor(ctx context.Context, userID string, at *time.Time) (time.Time, error) {
	prefs, err := s.users.Preferences(ctx, userID)
	if err != nil {
		return time.Time{}, err
	}
	var tz string
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err = s.users.Timezone(ctx, q, userID)
		return err
	})
	if err != nil {
		return time.Time{}, err
	}

	loc := timeutil.LoadLocation(tz)
	base := time.Now().In(loc)
	if at != nil {
		base = at.In(loc)
	}
	start, _ := timeutil.WeekBounds(base, loc, prefs.WeekStart)
	return start, nil
}

// GetMealPlan 读取某一周已确认的菜单。没有确认过时返回空条目。
func (s *Service) GetMealPlan(ctx context.Context, userID string, weekStart time.Time) (MealPlan, error) {
	var out MealPlan
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		plan, err := q.GetMealPlanByWeek(ctx, weekStart)
		if err != nil {
			if database.IsNoRows(err) {
				// 这一周还没确认过菜单。返回一个空壳而不是 404：
				// 客户端要渲染的是「这周还没安排」，不是错误页。
				out = MealPlan{Row: dbgen.MealPlan{WeekStart: weekStart}}
				return nil
			}
			return apperr.Internal(err)
		}
		entries, err := q.ListMealPlanEntries(ctx, plan.ID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = MealPlan{Row: plan, Entries: entries}
		return nil
	})
	return out, err
}

// ConfirmMealPlan 采用一份菜单，整周覆盖。
//
// 逐格增量提交会让「这周到底是哪一版」说不清楚，所以这里只接受整周替换：
// 删掉旧条目、写入新条目、推进版本号，全在一个事务里。
func (s *Service) ConfirmMealPlan(ctx context.Context, userID string,
	body httpapi.ConfirmMealPlanRequest, expectedVersion *int32) (MealPlan, error) {

	weekStart := body.WeekStart.Time
	if err := validateMealPlanEntries(weekStart, body.Entries); err != nil {
		return MealPlan{}, err
	}

	var out MealPlan
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// 版本冲突要在覆盖之前判断：先删后查等于已经把对方的菜单毁了。
		if expectedVersion != nil {
			current, err := q.GetMealPlanByWeek(ctx, weekStart)
			switch {
			case err == nil && current.Version != *expectedVersion:
				return apperr.New(apperr.CodeVersionConflict)
			case err != nil && !database.IsNoRows(err):
				return apperr.Internal(err)
			}
		}

		plan, err := q.UpsertMealPlan(ctx, dbgen.UpsertMealPlanParams{
			ID: idgen.New(idgen.PrefixMealPlan), UserID: userID, WeekStart: weekStart,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if err := q.DeleteMealPlanEntries(ctx, plan.ID); err != nil {
			return apperr.Internal(err)
		}

		for _, entry := range body.Entries {
			// 菜谱必须真实存在。外键也会拦，但那报出来的是约束名，
			// 用户看不懂哪一格填错了。
			if _, err := q.GetRecipe(ctx, entry.RecipeId); err != nil {
				if database.IsNoRows(err) {
					return apperr.Validation(apperr.Field("entries",
						fmt.Sprintf("菜谱 %s 不存在。", entry.RecipeId)))
				}
				return apperr.Internal(err)
			}
			if err := q.CreateMealPlanEntry(ctx, dbgen.CreateMealPlanEntryParams{
				ID: idgen.New(idgen.PrefixMealPlanEntry), UserID: userID,
				MealPlanID: plan.ID, EntryDate: entry.Date.Time,
				MealSlot: string(entry.MealSlot), RecipeID: entry.RecipeId,
			}); err != nil {
				return apperr.Internal(err)
			}
		}

		entries, err := q.ListMealPlanEntries(ctx, plan.ID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = MealPlan{Row: plan, Entries: entries}
		return nil
	})
	return out, err
}

// validateMealPlanEntries 校验条目落在本周之内且不重复。
func validateMealPlanEntries(weekStart time.Time, entries []httpapi.MealPlanEntryInput) error {
	weekEnd := weekStart.AddDate(0, 0, 7)
	seen := make(map[string]struct{}, len(entries))

	for _, entry := range entries {
		day := entry.Date.Time
		if day.Before(weekStart) || !day.Before(weekEnd) {
			return apperr.Validation(apperr.Field("entries",
				fmt.Sprintf("%s 不在这一周内。", timeutil.FormatDate(day))))
		}
		key := timeutil.FormatDate(day) + string(entry.MealSlot)
		if _, dup := seen[key]; dup {
			return apperr.Validation(apperr.Field("entries",
				fmt.Sprintf("%s 的%s安排了不止一道菜。",
					timeutil.FormatDate(day), mealSlotLabel(string(entry.MealSlot)))))
		}
		seen[key] = struct{}{}
	}
	return nil
}

func mealSlotLabel(slot string) string {
	switch slot {
	case "breakfast":
		return "早餐"
	case "lunch":
		return "午餐"
	case "dinner":
		return "晚餐"
	default:
		return slot
	}
}

// PlannedNutrition 把整周条目的营养估算求和。
//
// 它是**计划**摄入，和用户实际记录的摄入是两回事，
// 客户端不得把两者混在一起展示。
func PlannedNutrition(entries []dbgen.ListMealPlanEntriesRow) httpapi.RecipeNutrition {
	var out httpapi.RecipeNutrition
	for _, entry := range entries {
		out.Calories += entry.Recipe.Calories
		out.ProteinG += entry.Recipe.ProteinG
		out.CarbsG += entry.Recipe.CarbsG
		out.FiberG += entry.Recipe.FiberG
	}
	return out
}

// ---- 购物清单草稿 ----

// ShoppingItem 是合并后的一项食材。
type ShoppingItem struct {
	Name      string
	Group     string
	Quantity  string
	RecipeIDs []string
}

// ShoppingDraft 按已确认菜单合并出待采购食材。
//
// 只读，不创建任何东西：用户要先在这个基础上排除家中已有的，
// 确认之后才走创建接口。
func (s *Service) ShoppingDraft(ctx context.Context, userID string,
	weekStart time.Time, onlyDate *time.Time) ([]ShoppingItem, error) {

	plan, err := s.GetMealPlan(ctx, userID, weekStart)
	if err != nil {
		return nil, err
	}
	entries := plan.Entries
	if onlyDate != nil {
		entries = entriesOnDay(entries, *onlyDate)
	}
	return mergeIngredients(entries), nil
}

// entriesOnDay 只留某一天的条目。
func entriesOnDay(entries []dbgen.ListMealPlanEntriesRow, day time.Time) []dbgen.ListMealPlanEntriesRow {
	want := timeutil.FormatDate(day)
	out := make([]dbgen.ListMealPlanEntriesRow, 0, 3)
	for _, entry := range entries {
		if timeutil.FormatDate(entry.EntryDate) == want {
			out = append(out, entry)
		}
	}
	return out
}

// mergeIngredients 合并重复食材。
//
// 同名食材的份量按原样并列而不是求和：「2 个」加「少许」算不出一个准确总量，
// 硬凑一个数反而误导。数量能不能相加是单位问题，不是字符串问题。
func mergeIngredients(entries []dbgen.ListMealPlanEntriesRow) []ShoppingItem {
	type bucket struct {
		item       ShoppingItem
		quantities []string
		seenFrom   map[string]struct{}
	}
	merged := map[string]*bucket{}
	var order []string

	for _, entry := range entries {
		for _, ing := range decodeIngredients(entry.Recipe.Ingredients) {
			name := strings.TrimSpace(ing.Name)
			if name == "" {
				continue
			}
			existing, ok := merged[name]
			if !ok {
				existing = &bucket{
					item:     ShoppingItem{Name: name, Group: string(ing.Group)},
					seenFrom: map[string]struct{}{},
				}
				merged[name] = existing
				order = append(order, name)
			}
			if quantity := strings.TrimSpace(ing.Amount); quantity != "" {
				existing.quantities = append(existing.quantities, quantity)
			}
			if _, dup := existing.seenFrom[entry.Recipe.ID]; !dup {
				existing.seenFrom[entry.Recipe.ID] = struct{}{}
				existing.item.RecipeIDs = append(existing.item.RecipeIDs, entry.Recipe.ID)
			}
		}
	}

	out := make([]ShoppingItem, 0, len(order))
	for _, name := range order {
		b := merged[name]
		b.item.Quantity = strings.Join(b.quantities, " + ")
		out = append(out, b.item)
	}
	// 按品类再按名称排序，购物时同类食材挨在一起。
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return groupOrder(out[i].Group) < groupOrder(out[j].Group)
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// groupOrder 决定品类在清单里的先后。顺序与购物清单页的分组一致。
func groupOrder(group string) int {
	switch group {
	case "produce":
		return 0
	case "protein":
		return 1
	case "staple":
		return 2
	case "seasoning":
		return 3
	default:
		return 4
	}
}

func stringPtrOf[T ~string](v *T) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

func int32PtrOf(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}

// trimmedList 归一化字符串数组。nil 表示不修改，空数组表示清空。
func trimmedList(values *[]string) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(*values))
	for _, value := range *values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// ---- 从菜单创建购物清单 ----

// ListCommands 是本模块需要的清单能力，由 bootstrap 注入。
type ListCommands interface {
	CreateInTx(ctx context.Context, q *dbgen.Queries, userID string,
		in lists.CreateInput) (dbgen.TaskList, error)
}

// TaskCommands 是本模块需要的任务能力。
type TaskCommands interface {
	CreateTaskInTx(ctx context.Context, q *dbgen.Queries, userID string,
		cmd objects.CreateTaskCommand) (dbgen.Task, error)
}

// CreateShoppingList 把选中的食材创建成正式购物清单。
//
// 复用 TaskList / Task，不创建与之同义的食材待办类型（规格 8.2.2）。
// 清单与全部条目在同一个事务里落库：只建出一个空清单，
// 用户不知道该重来还是接着填。
func (s *Service) CreateShoppingList(ctx context.Context, userID string,
	body httpapi.CreateShoppingListRequest) (dbgen.TaskList, error) {

	if len(body.Items) == 0 {
		return dbgen.TaskList{}, apperr.Validation(
			apperr.Field("items", "至少要选一项食材。"))
	}

	name := strings.TrimSpace(valueOr(body.ListName))
	if name == "" {
		name = fmt.Sprintf("%s那周的采购", timeutil.FormatDate(body.WeekStart.Time))
	}

	var out dbgen.TaskList
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		list, err := s.lists.CreateInTx(ctx, q, userID, lists.CreateInput{
			Name: name, ListKind: "shopping",
		})
		if err != nil {
			return err
		}

		for _, item := range body.Items {
			title := strings.TrimSpace(item.Name)
			if title == "" {
				continue
			}
			// 份量写进描述而不是标题：标题是「买什么」，
			// 拼成「鸡蛋 6 个 + 少许」会让勾选列表变得很难扫。
			description := strings.TrimSpace(item.QuantityText)

			cmd := objects.CreateTaskCommand{
				Title:     title,
				Priority:  "normal",
				ListID:    list.ID,
				CreatedBy: "user",
			}
			if description != "" {
				cmd.Description = &description
			}
			// 记下这项是为哪几道菜买的，用户在清单里看得到来源。
			for _, recipeID := range valueOrEmpty(item.RecipeIds) {
				cmd.Provenance = append(cmd.Provenance, objects.ProvenanceInput{
					SourceType: "recipe", SourceID: recipeID, Action: "created",
				})
			}
			if _, err := s.objects.CreateTaskInTx(ctx, q, userID, cmd); err != nil {
				return err
			}
		}
		out = list
		return nil
	})
	return out, err
}

func valueOr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func valueOrEmpty(v *[]string) []string {
	if v == nil {
		return nil
	}
	return *v
}
