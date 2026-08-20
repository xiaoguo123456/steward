// Package recipes 提供只读的菜谱内容。
//
// 菜谱是平台内容，不是用户数据：所有用户看到同一份，因此这张表不带 user_id，
// 也不受行级安全约束，更没有面向用户的写接口。
//
// 用户自己的东西是「本周菜单」和「实际摄入」，它们分别是 Note/Task 与 Record，
// 照常走各自的领域接口并受 RLS 约束。
package recipes

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// Service 拥有菜谱内容与用户自己的食谱数据。
//
// 菜谱本身只读且不分用户；饮食档案、收藏、做过与本周菜单都属于某个人，
// 见 userdata.go。
type Service struct {
	db      *database.DB
	users   UserProfile
	lists   ListCommands
	objects TaskCommands
}

// New 构造 Service。
func New(db *database.DB, users UserProfile, listCmds ListCommands, taskCmds TaskCommands) *Service {
	return &Service{db: db, users: users, lists: listCmds, objects: taskCmds}
}

// Filter 是菜谱查询条件。
type Filter struct {
	Query     *string
	Category  *string
	MealSlot  *string
	MaxMinute *int32
	// ExcludeAllergens 是硬过滤：命中一个就整条排除，排序不得覆盖。
	ExcludeAllergens []string
	Limit            int32
}

// List 查询菜谱。
//
// 菜谱表不属于任何用户，但读取仍然要求已登录：内容是产品的一部分，
// 不对匿名请求开放。
func (s *Service) List(ctx context.Context, userID string, f Filter) ([]dbgen.Recipe, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 30
	}
	if f.ExcludeAllergens == nil {
		f.ExcludeAllergens = []string{}
	}

	var out []dbgen.Recipe
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListRecipes(ctx, dbgen.ListRecipesParams{
			Query:            f.Query,
			Category:         f.Category,
			MealSlot:         f.MealSlot,
			MaxMinutes:       f.MaxMinute,
			ExcludeAllergens: f.ExcludeAllergens,
			RowLimit:         f.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// Get 读取单个菜谱。
func (s *Service) Get(ctx context.Context, userID, recipeID string) (dbgen.Recipe, error) {
	var out dbgen.Recipe
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetRecipe(ctx, recipeID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个菜谱")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// MapRecipe 把存储行映射成契约 DTO。
func MapRecipe(row dbgen.Recipe) httpapi.Recipe {
	out := httpapi.Recipe{
		Id:              row.ID,
		Title:           row.Title,
		Summary:         row.Summary,
		ImageUrl:        row.ImageUrl,
		Servings:        int(row.Servings),
		DurationMinutes: int(row.DurationMinutes),
		Difficulty:      httpapi.RecipeDifficulty(row.Difficulty),
		Nutrition: httpapi.RecipeNutrition{
			Calories: row.Calories,
			ProteinG: row.ProteinG,
			CarbsG:   row.CarbsG,
			// 空表示「不知道」而不是 0：不同来源给出的营养项不一样，
			// 手写内容有膳食纤维没有脂肪，导入内容反过来。
			FatG:   row.FatG,
			FiberG: row.FiberG,
		},
		MealSlots:   mapEnums[httpapi.RecipeMealSlot](row.MealSlots),
		Categories:  mapEnums[httpapi.RecipeCategory](row.Categories),
		Goals:       mapEnums[httpapi.RecipeGoal](row.Goals),
		Tags:        orEmpty(row.Tags),
		Allergens:   orEmpty(row.Allergens),
		Ingredients: decodeIngredients(row.Ingredients),
		Steps:       decodeSteps(row.Steps),
		Source: httpapi.RecipeSource{
			Name:           row.SourceName,
			Author:         row.SourceAuthor,
			Url:            row.SourceUrl,
			License:        row.License,
			LicenseUrl:     row.LicenseUrl,
			ImageCredit:    row.ImageCredit,
			ContentVersion: row.ContentVersion,
		},
	}
	return out
}

func mapEnums[T ~string](values []string) []T {
	out := make([]T, 0, len(values))
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			continue
		}
		out = append(out, T(v))
	}
	return out
}

func orEmpty(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func decodeIngredients(raw []byte) []httpapi.RecipeIngredient {
	var out []httpapi.RecipeIngredient
	if err := json.Unmarshal(raw, &out); err != nil {
		return []httpapi.RecipeIngredient{}
	}
	return out
}

func decodeSteps(raw []byte) []httpapi.RecipeStep {
	var out []httpapi.RecipeStep
	if err := json.Unmarshal(raw, &out); err != nil {
		return []httpapi.RecipeStep{}
	}
	return out
}
