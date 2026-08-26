package recipes

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/lists"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// 用户食谱数据的 HTTP 层。菜谱内容的两个只读操作在 handler.go。

// GetDietProfile 读取饮食档案。
func (h *RecipeAPI) GetDietProfile(ctx context.Context,
	_ httpapi.GetDietProfileRequestObject) (httpapi.GetDietProfileResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.DietProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	return httpapi.GetDietProfile200JSONResponse{
		Data: mapDietProfile(row), Meta: httpx.Meta(ctx),
	}, nil
}

// UpdateDietProfile 修改饮食档案。
func (h *RecipeAPI) UpdateDietProfile(ctx context.Context,
	req httpapi.UpdateDietProfileRequestObject) (httpapi.UpdateDietProfileResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.UpdateDietProfile(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateDietProfile200JSONResponse{
		Data: mapDietProfile(row), Meta: httpx.Meta(ctx),
	}, nil
}

// ListFavoriteRecipes 查询收藏的菜谱。
func (h *RecipeAPI) ListFavoriteRecipes(ctx context.Context,
	req httpapi.ListFavoriteRecipesRequestObject) (httpapi.ListFavoriteRecipesResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := h.svc.ListFavorites(ctx, userID, httpx.PageLimit(req.Params.Limit))
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.Recipe, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapRecipe(row))
	}
	return httpapi.ListFavoriteRecipes200JSONResponse{
		Data: data, Page: httpx.PageOf(false, ""), Meta: httpx.Meta(ctx),
	}, nil
}

// FavoriteRecipe 收藏一道菜。
func (h *RecipeAPI) FavoriteRecipe(ctx context.Context,
	req httpapi.FavoriteRecipeRequestObject) (httpapi.FavoriteRecipeResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.SetFavorite(ctx, userID, req.RecipeId, true); err != nil {
		return nil, err
	}
	return httpapi.FavoriteRecipe200JSONResponse(
		httpx.Mutation(ctx, "", recipeResource(req.RecipeId))), nil
}

// UnfavoriteRecipe 取消收藏。
func (h *RecipeAPI) UnfavoriteRecipe(ctx context.Context,
	req httpapi.UnfavoriteRecipeRequestObject) (httpapi.UnfavoriteRecipeResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.SetFavorite(ctx, userID, req.RecipeId, false); err != nil {
		return nil, err
	}
	return httpapi.UnfavoriteRecipe200JSONResponse(
		httpx.Mutation(ctx, "", recipeResource(req.RecipeId))), nil
}

// MarkRecipeCooked 标记做过这道菜。
func (h *RecipeAPI) MarkRecipeCooked(ctx context.Context,
	req httpapi.MarkRecipeCookedRequestObject) (httpapi.MarkRecipeCookedResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.MarkCooked(ctx, userID, req.RecipeId); err != nil {
		return nil, err
	}
	return httpapi.MarkRecipeCooked200JSONResponse(
		httpx.Mutation(ctx, "", recipeResource(req.RecipeId))), nil
}

// GetMealPlan 读取某一周已确认的菜单。
func (h *RecipeAPI) GetMealPlan(ctx context.Context,
	req httpapi.GetMealPlanRequestObject) (httpapi.GetMealPlanResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	weekStart, err := h.resolveWeekStart(ctx, userID, req.Params.WeekStart)
	if err != nil {
		return nil, err
	}
	plan, err := h.svc.GetMealPlan(ctx, userID, weekStart)
	if err != nil {
		return nil, err
	}
	return httpapi.GetMealPlan200JSONResponse{
		Data: mapMealPlan(weekStart, plan), Meta: httpx.Meta(ctx),
	}, nil
}

// ConfirmMealPlan 采用本周菜单。
func (h *RecipeAPI) ConfirmMealPlan(ctx context.Context,
	req httpapi.ConfirmMealPlanRequestObject) (httpapi.ConfirmMealPlanResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	plan, err := h.svc.ConfirmMealPlan(ctx, userID, *req.Body, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	return httpapi.ConfirmMealPlan200JSONResponse{
		Data: mapMealPlan(req.Body.WeekStart.Time, plan), Meta: httpx.Meta(ctx),
	}, nil
}

// GetMealPlanShoppingDraft 按已确认菜单合并出待采购食材。
func (h *RecipeAPI) GetMealPlanShoppingDraft(ctx context.Context,
	req httpapi.GetMealPlanShoppingDraftRequestObject) (httpapi.GetMealPlanShoppingDraftResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	weekStart, err := h.resolveWeekStart(ctx, userID, req.Params.WeekStart)
	if err != nil {
		return nil, err
	}
	var onlyDate *time.Time
	if req.Params.Date != nil {
		onlyDate = &req.Params.Date.Time
	}
	items, err := h.svc.ShoppingDraft(ctx, userID, weekStart, onlyDate)
	if err != nil {
		return nil, err
	}

	data := make([]httpapi.ShoppingDraftItem, 0, len(items))
	for _, item := range items {
		recipeIDs := item.RecipeIDs
		if recipeIDs == nil {
			recipeIDs = []string{}
		}
		data = append(data, httpapi.ShoppingDraftItem{
			Name:         item.Name,
			Group:        httpapi.RecipeIngredientGroup(item.Group),
			QuantityText: item.Quantity,
			RecipeIds:    recipeIDs,
		})
	}
	return httpapi.GetMealPlanShoppingDraft200JSONResponse{
		Data: httpapi.ShoppingDraft{
			WeekStart: openapi_types.Date{Time: weekStart},
			Items:     data,
		},
		Meta: httpx.Meta(ctx),
	}, nil
}

// CreateShoppingListFromMealPlan 用选中的食材创建购物清单。
func (h *RecipeAPI) CreateShoppingListFromMealPlan(ctx context.Context,
	req httpapi.CreateShoppingListFromMealPlanRequestObject) (httpapi.CreateShoppingListFromMealPlanResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	list, err := h.svc.CreateShoppingList(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateShoppingListFromMealPlan201JSONResponse{
		Data: lists.MapTaskList(list, nil, h.svc.lists.ArchiveRetentionSeconds()), Meta: httpx.Meta(ctx),
	}, nil
}

// resolveWeekStart 决定这次查的是哪一周。
//
// 不传时由服务端按用户的周起始日偏好与时区算本周：
// 客户端自己算会在跨时区和「周一还是周日开始」上和服务端不一致。
func (h *RecipeAPI) resolveWeekStart(ctx context.Context, userID string,
	raw *openapi_types.Date) (time.Time, error) {

	if raw != nil {
		return raw.Time, nil
	}
	return h.svc.WeekStartFor(ctx, userID, nil)
}

func recipeResource(recipeID string) httpapi.AffectedResource {
	return httpapi.AffectedResource{
		Type: httpapi.AffectedResourceTypeRecipe, Id: &recipeID,
	}
}

func mapDietProfile(row dbgen.RecipeDietProfile) httpapi.DietProfile {
	goal := httpapi.DietGoal(row.Goal)
	sex := httpapi.DietSex(row.Sex)
	activity := httpapi.DietActivityLevel(row.ActivityLevel)
	completed := row.Completed

	budget := httpapi.DietBudget(row.Budget)
	diagnosed := row.DiagnosedCondition

	out := httpapi.DietProfile{
		Goal:               goal,
		Sex:                &sex,
		ActivityLevel:      &activity,
		Allergens:          row.Allergens,
		Dislikes:           row.Dislikes,
		Servings:           int(row.Servings),
		Completed:          &completed,
		Budget:             &budget,
		Tastes:             &row.Tastes,
		Equipment:          &row.Equipment,
		DiagnosedCondition: &diagnosed,
		UpdatedAt:          row.UpdatedAt,
	}
	if row.Age != nil {
		age := int(*row.Age)
		out.Age = &age
	}
	out.HeightCm = row.HeightCm
	out.WeightKg = row.WeightKg
	out.TargetWeightKg = row.TargetWeightKg
	if row.MaxCookMinutes != nil {
		minutes := int(*row.MaxCookMinutes)
		out.MaxCookMinutes = &minutes
	}
	return out
}

func mapMealPlan(weekStart time.Time, plan MealPlan) httpapi.MealPlan {
	entries := make([]httpapi.MealPlanEntry, 0, len(plan.Entries))
	for _, row := range plan.Entries {
		recipe := MapRecipe(row.Recipe)
		entry := httpapi.MealPlanEntry{
			Date:     openapi_types.Date{Time: row.EntryDate},
			MealSlot: httpapi.RecipeMealSlot(row.MealSlot),
			RecipeId: row.Recipe.ID,
			Recipe:   &recipe,
		}
		if row.Component != nil {
			component := httpapi.RecipeComponent(*row.Component)
			entry.Component = &component
		}
		entries = append(entries, entry)
	}

	out := httpapi.MealPlan{
		Id:               plan.Row.ID,
		WeekStart:        openapi_types.Date{Time: weekStart},
		Entries:          entries,
		PlannedNutrition: PlannedNutrition(plan.Entries),
		CreatedAt:        plan.Row.CreatedAt,
		UpdatedAt:        plan.Row.UpdatedAt,
		Version:          int(plan.Row.Version),
	}
	return out
}

// GetMealPlanSuggestion 按饮食档案生成一周菜单建议。
//
// 只读：算完就返回，不写库。用户点「采用本周菜单」才走 ConfirmMealPlan。
func (h *RecipeAPI) GetMealPlanSuggestion(ctx context.Context,
	req httpapi.GetMealPlanSuggestionRequestObject) (httpapi.GetMealPlanSuggestionResponseObject, error) {

	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	weekStart, err := h.resolveWeekStart(ctx, userID, req.Params.WeekStart)
	if err != nil {
		return nil, err
	}
	seed := 0
	if req.Params.Seed != nil {
		seed = *req.Params.Seed
	}

	suggestion, err := h.svc.SuggestMealPlan(ctx, userID, weekStart, seed)
	if err != nil {
		return nil, err
	}
	recipes, err := h.svc.RecipesByIDs(ctx, userID, suggestion.RecipeIDs())
	if err != nil {
		return nil, err
	}

	return httpapi.GetMealPlanSuggestion200JSONResponse{
		Data: mapSuggestion(suggestion, recipes), Meta: httpx.Meta(ctx),
	}, nil
}

func mapSuggestion(s Suggestion, recipes map[string]dbgen.Recipe) httpapi.MealPlanSuggestion {
	entries := make([]httpapi.MealPlanEntry, 0, len(s.Entries))
	for _, item := range s.Entries {
		entry := httpapi.MealPlanEntry{
			Date:     openapi_types.Date{Time: item.Date},
			MealSlot: httpapi.RecipeMealSlot(item.MealSlot),
			RecipeId: item.RecipeID,
		}
		if item.Component != "" {
			component := httpapi.RecipeComponent(item.Component)
			entry.Component = &component
		}
		if row, ok := recipes[item.RecipeID]; ok {
			recipe := MapRecipe(row)
			entry.Recipe = &recipe
		}
		entries = append(entries, entry)
	}

	notes := make([]httpapi.MealPlanSuggestionNote, 0, len(s.Notes))
	for _, note := range s.Notes {
		mapped := httpapi.MealPlanSuggestionNote{
			Kind:    httpapi.MealPlanSuggestionNoteKind(note.Kind),
			Message: note.Message,
		}
		if note.MealSlot != "" {
			slot := httpapi.RecipeMealSlot(note.MealSlot)
			mapped.MealSlot = &slot
		}
		notes = append(notes, mapped)
	}

	out := httpapi.MealPlanSuggestion{
		WeekStart: openapi_types.Date{Time: s.WeekStart},
		Seed:      s.Seed,
		Entries:   entries,
		Achieved: httpapi.DailyNutritionAchieved{
			Calories: s.Achieved.Calories,
			ProteinG: s.Achieved.ProteinG,
			CarbsG:   s.Achieved.CarbsG,
			FatG:     s.Achieved.FatG,
		},
		Candidates: httpapi.MealPlanCandidateCounts{
			Breakfast: s.Candidates["breakfast"],
			Lunch:     s.Candidates["lunch"],
			Dinner:    s.Candidates["dinner"],
		},
		Notes: notes,
	}
	if s.DailyTarget != nil {
		out.DailyTarget = &httpapi.DailyNutritionTarget{
			Calories: s.DailyTarget.Calories,
			ProteinG: s.DailyTarget.ProteinG,
			CarbsG:   s.DailyTarget.CarbsG,
			FatG:     s.DailyTarget.FatG,
		}
	}
	return out
}
