package recipes

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// RecipeAPI 把生成的 strict server 接口映射到菜谱服务。
type RecipeAPI struct {
	svc *Service
}

// NewRecipeAPI 构造 RecipeAPI。
func NewRecipeAPI(svc *Service) *RecipeAPI { return &RecipeAPI{svc: svc} }

// ListRecipes 查询菜谱。
func (h *RecipeAPI) ListRecipes(ctx context.Context, req httpapi.ListRecipesRequestObject) (httpapi.ListRecipesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}

	filter := Filter{Query: req.Params.Q, Limit: httpx.PageLimit(req.Params.Limit)}
	if req.Params.Category != nil {
		v := string(*req.Params.Category)
		filter.Category = &v
	}
	if req.Params.MealSlot != nil {
		v := string(*req.Params.MealSlot)
		filter.MealSlot = &v
	}
	if req.Params.MaxMinutes != nil {
		v := int32(*req.Params.MaxMinutes)
		filter.MaxMinute = &v
	}
	if req.Params.ExcludeAllergens != nil {
		filter.ExcludeAllergens = *req.Params.ExcludeAllergens
	}

	rows, err := h.svc.List(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.Recipe, 0, len(rows))
	for _, row := range rows {
		data = append(data, MapRecipe(row))
	}
	// 菜谱一次返回全部命中，不提供游标翻页。
	return httpapi.ListRecipes200JSONResponse{
		Data: data, Page: httpx.PageOf(false, ""), Meta: httpx.Meta(ctx),
	}, nil
}

// GetRecipe 读取菜谱详情。
func (h *RecipeAPI) GetRecipe(ctx context.Context, req httpapi.GetRecipeRequestObject) (httpapi.GetRecipeResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Get(ctx, userID, req.RecipeId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetRecipe200JSONResponse{Data: MapRecipe(row), Meta: httpx.Meta(ctx)}, nil
}
