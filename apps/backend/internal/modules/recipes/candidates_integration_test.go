package recipes

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 候选查询的集成测试。
//
// **过敏原过滤发生在这条 SQL 里，不在 Go 里。** suggest_test.go 只能保证
// 生成器不会选池子外的菜；池子本身干不干净，只有连真实数据库才测得出来。
// 这一条断了，用户填的过敏原就等于没填，而症状是「菜单看起来很正常」。
//
// 没配 STEWARD_TEST_DATABASE_URL 时跳过，先跑 make migrate-test。

func candidateTestDB(t *testing.T) *database.DB {
	t.Helper()
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过候选查询集成测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

type fixture struct {
	id         string
	title      string
	minutes    int32
	allergens  []string
	ingredient string
}

// seedCandidateFixtures 写入几条带固定 ID 前缀的菜谱，测完删掉。
// 菜谱是平台内容、不受 RLS，因此用匿名事务即可。
func seedCandidateFixtures(t *testing.T, db *database.DB, rows []fixture) {
	t.Helper()
	ctx := context.Background()

	err := db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		for _, r := range rows {
			ingredients, _ := json.Marshal([]map[string]string{
				{"name": r.ingredient, "group": "produce", "amount": "适量"},
			})
			steps, _ := json.Marshal([]map[string]any{{"order": 1, "text": "略"}})
			if err := q.UpsertRecipe(ctx, dbgen.UpsertRecipeParams{
				ID: r.id, Title: r.title, Servings: 1,
				DurationMinutes: r.minutes, Difficulty: "easy",
				Calories: 300, ProteinG: 20, CarbsG: 30,
				MealSlots:   []string{"lunch"},
				Categories:  []string{"stir_fry"},
				Goals:       []string{},
				Tags:        []string{},
				Allergens:   r.allergens,
				Ingredients: ingredients, Steps: steps,
				SourceName: "测试", License: "测试", ContentVersion: "test",
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("写入测试菜谱失败：%v", err)
	}

	t.Cleanup(func() {
		_ = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			for _, r := range rows {
				if _, err := tx.Exec(ctx, "DELETE FROM recipes WHERE id = $1", r.id); err != nil {
					return err
				}
			}
			return nil
		})
	})
}

func queryCandidates(t *testing.T, db *database.DB, params dbgen.ListRecipeCandidatesParams) map[string]bool {
	t.Helper()
	got := map[string]bool{}
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListRecipeCandidates(ctx, params)
		if err != nil {
			return err
		}
		for _, row := range rows {
			got[row.ID] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("查询候选失败：%v", err)
	}
	return got
}

func TestCandidateQueryExcludesAllergens(t *testing.T) {
	db := candidateTestDB(t)
	rows := []fixture{
		{"rcp_test_peanut", "宫保鸡丁", 20, []string{"花生", "大豆"}, "花生"},
		{"rcp_test_egg", "番茄炒蛋", 10, []string{"鸡蛋"}, "鸡蛋"},
		{"rcp_test_clean", "清炒时蔬", 8, []string{}, "青菜"},
	}
	seedCandidateFixtures(t, db, rows)

	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{"花生"},
		Dislikes:         []string{},
	})

	if got["rcp_test_peanut"] {
		t.Error("对花生过敏，含花生的菜绝不能进候选")
	}
	if !got["rcp_test_clean"] || !got["rcp_test_egg"] {
		t.Error("不含花生的菜应当照常返回")
	}
}

// 过敏原是数组重叠：命中其中任意一个就整条排除。
func TestCandidateQueryExcludesAnyMatchingAllergen(t *testing.T) {
	db := candidateTestDB(t)
	seedCandidateFixtures(t, db, []fixture{
		{"rcp_test_multi", "麻婆豆腐", 20, []string{"大豆", "小麦"}, "豆腐"},
		{"rcp_test_plain", "白灼菜心", 6, []string{}, "菜心"},
	})

	// 只对小麦过敏，而这道菜同时含大豆与小麦——一样要排掉。
	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{"小麦"},
		Dislikes:         []string{},
	})
	if got["rcp_test_multi"] {
		t.Error("过敏原数组只要有一项命中就该整条排除")
	}
	if !got["rcp_test_plain"] {
		t.Error("无过敏原的菜应当返回")
	}
}

// 没有过敏原时必须照常返回全部——空数组不能被当成「全部排除」。
// Postgres 里 `x && NULL` 是 NULL 不是 false，传错就一条都查不到。
func TestCandidateQueryEmptyAllergensReturnsAll(t *testing.T) {
	db := candidateTestDB(t)
	seedCandidateFixtures(t, db, []fixture{
		{"rcp_test_any", "蒜蓉西兰花", 12, []string{"大豆"}, "西兰花"},
	})

	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{},
		Dislikes:         []string{},
	})
	if !got["rcp_test_any"] {
		t.Error("没填过敏原时不该排除任何菜")
	}
}

// 忌口要连食材一起看：菜名里没有但配料里有，一样得排除。
func TestCandidateQueryExcludesDislikesByIngredient(t *testing.T) {
	db := candidateTestDB(t)
	seedCandidateFixtures(t, db, []fixture{
		{"rcp_test_cilantro", "牛肉汤", 30, []string{}, "香菜"},
		{"rcp_test_named", "香菜拌豆腐", 5, []string{}, "豆腐"},
		{"rcp_test_neither", "土豆丝", 15, []string{}, "土豆"},
	})

	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{},
		Dislikes:         []string{"香菜"},
	})

	if got["rcp_test_cilantro"] {
		t.Error("菜名没写但配料里有香菜，也该排除")
	}
	if got["rcp_test_named"] {
		t.Error("菜名里带香菜的应当排除")
	}
	if !got["rcp_test_neither"] {
		t.Error("和香菜无关的菜应当保留")
	}
}

// 忌口列表里的空字符串不能把所有菜都滤掉。
// 用户在偏好页删掉一项时很容易留下空串，那时菜单会整周变空。
func TestCandidateQueryIgnoresBlankDislikes(t *testing.T) {
	db := candidateTestDB(t)
	seedCandidateFixtures(t, db, []fixture{
		{"rcp_test_blank", "青椒肉丝", 18, []string{}, "青椒"},
	})

	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{},
		Dislikes:         []string{"", "  "},
	})
	if !got["rcp_test_blank"] {
		t.Error("空白忌口项应当被忽略，不能把所有菜都滤掉")
	}
}

func TestCandidateQueryRespectsMaxMinutes(t *testing.T) {
	db := candidateTestDB(t)
	seedCandidateFixtures(t, db, []fixture{
		{"rcp_test_fast", "凉拌黄瓜", 5, []string{}, "黄瓜"},
		{"rcp_test_slow", "红烧肉", 90, []string{}, "五花肉"},
	})

	limit := int32(20)
	got := queryCandidates(t, db, dbgen.ListRecipeCandidatesParams{
		MealSlot:         "lunch",
		ExcludeAllergens: []string{},
		Dislikes:         []string{},
		MaxMinutes:       &limit,
	})
	if got["rcp_test_slow"] {
		t.Error("超过最长烹饪时间的菜不该返回")
	}
	if !got["rcp_test_fast"] {
		t.Error("时间内的菜应当返回")
	}
}
