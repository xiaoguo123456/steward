package main

import (
	"context"
	"encoding/json"
	"log"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 示例菜谱。
//
// 这几条是平台自有的占位内容，用来把「菜单 → 购物清单 → 实际摄入」的链路
// 跑通。它们**不是**正式菜谱库：正式内容接入前必须确定来源、作者、
// 图片权利与授权范围，那正是 source 字段存在的理由。
//
// image_url 全部留空：没有明确图片权利的图不下发，客户端展示占位。
// 与其挂一张来路不明的图，不如先没有图。

type recipeSeed struct {
	ID          string
	Title       string
	Summary     string
	Servings    int32
	Minutes     int32
	Difficulty  string
	Calories    float64
	Protein     float64
	Carbs       float64
	Fiber       float64
	MealSlots   []string
	Categories  []string
	Goals       []string
	Tags        []string
	Allergens   []string
	Ingredients []httpapi.RecipeIngredient
	Steps       []httpapi.RecipeStep
}

func ing(name, amount, group string) httpapi.RecipeIngredient {
	return httpapi.RecipeIngredient{
		Name: name, Amount: amount,
		Group: httpapi.RecipeIngredientGroup(group),
	}
}

func step(title, description string, timer int) httpapi.RecipeStep {
	s := httpapi.RecipeStep{Title: title, Description: description}
	if timer > 0 {
		s.TimerMinutes = &timer
	}
	return s
}

var seedRecipes = []recipeSeed{
	{
		ID: "rcp_tomato_beef_pasta", Title: "番茄牛肉意面",
		Summary:  "番茄的酸甜配上牛肉末，煮一锅面就是一顿正餐。",
		Servings: 2, Minutes: 30, Difficulty: "easy",
		Calories: 520, Protein: 28, Carbs: 62, Fiber: 6,
		MealSlots:  []string{"lunch", "dinner"},
		Categories: []string{"recommended", "muscle_gain"},
		Goals:      []string{"balanced", "muscle_gain"},
		Tags:       []string{"一锅出", "适合带饭"},
		Allergens:  []string{"麸质"},
		Ingredients: []httpapi.RecipeIngredient{
			ing("意面", "200 克", "staple"),
			ing("牛肉末", "300 克", "protein"),
			ing("番茄", "4 个", "produce"),
			ing("洋葱", "半个", "produce"),
			ing("橄榄油", "1 汤匙", "seasoning"),
			ing("盐", "适量", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("烧水煮面", "水开后下意面，按包装标注的时间煮。", 9),
			step("炒香配料", "洋葱切丁炒软，下牛肉末炒到变色。", 0),
			step("熬番茄", "番茄切块下锅，中小火熬到出汁。", 8),
			step("拌匀", "面捞出拌进酱里，尝味后补盐。", 0),
		},
	},
	{
		ID: "rcp_oat_bowl", Title: "隔夜燕麦碗",
		Summary:  "前一晚泡上，早上拿出来就能吃。",
		Servings: 1, Minutes: 5, Difficulty: "easy",
		Calories: 340, Protein: 14, Carbs: 48, Fiber: 8,
		MealSlots:  []string{"breakfast"},
		Categories: []string{"quick", "steady_sugar"},
		Goals:      []string{"balanced", "steady_sugar"},
		Tags:       []string{"免开火", "高纤维"},
		Allergens:  []string{"牛奶", "坚果"},
		Ingredients: []httpapi.RecipeIngredient{
			ing("燕麦", "50 克", "staple"),
			ing("牛奶", "150 毫升", "protein"),
			ing("香蕉", "1 根", "produce"),
			ing("坚果碎", "1 汤匙", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("泡上", "燕麦和牛奶装进密封盒，冷藏一夜。", 0),
			step("加料", "第二天早上放香蕉片和坚果碎。", 0),
		},
	},
	{
		ID: "rcp_steamed_fish", Title: "清蒸鲈鱼",
		Summary:  "十分钟出锅，鲜味全在鱼本身。",
		Servings: 3, Minutes: 25, Difficulty: "medium",
		Calories: 260, Protein: 34, Carbs: 4, Fiber: 1,
		MealSlots:  []string{"dinner"},
		Categories: []string{"recommended", "fat_loss"},
		Goals:      []string{"fat_loss", "balanced"},
		Tags:       []string{"低脂", "高蛋白"},
		Allergens:  []string{"鱼类", "大豆"},
		Ingredients: []httpapi.RecipeIngredient{
			ing("鲈鱼", "1 条", "protein"),
			ing("生姜", "3 片", "produce"),
			ing("小葱", "2 根", "produce"),
			ing("蒸鱼豉油", "2 汤匙", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("处理鱼", "鱼身两面划刀，塞进姜片。", 0),
			step("上锅蒸", "水开后大火蒸，别揭盖。", 9),
			step("淋汁", "倒掉盘里的水，铺葱丝，淋热油和豉油。", 0),
		},
	},
	{
		ID: "rcp_chicken_salad", Title: "鸡胸沙拉碗",
		Summary:  "煎一块鸡胸，配菜随手抓。",
		Servings: 1, Minutes: 20, Difficulty: "easy",
		Calories: 380, Protein: 38, Carbs: 22, Fiber: 7,
		MealSlots:  []string{"lunch"},
		Categories: []string{"fat_loss", "quick"},
		Goals:      []string{"fat_loss", "muscle_gain"},
		Tags:       []string{"高蛋白", "备餐友好"},
		Allergens:  []string{},
		Ingredients: []httpapi.RecipeIngredient{
			ing("鸡胸肉", "200 克", "protein"),
			ing("生菜", "1 把", "produce"),
			ing("小番茄", "8 个", "produce"),
			ing("橄榄油", "1 茶匙", "seasoning"),
			ing("黑胡椒", "适量", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("腌一下", "鸡胸切厚片，用盐和黑胡椒抓匀，放十分钟。", 10),
			step("煎熟", "中火下锅，两面煎到不粉。", 8),
			step("拌起来", "菜洗净沥干，鸡胸切条铺上，淋橄榄油。", 0),
		},
	},
	{
		ID: "rcp_egg_fried_rice", Title: "隔夜饭蛋炒饭",
		Summary:  "冰箱里有什么放什么，十分钟解决一餐。",
		Servings: 2, Minutes: 12, Difficulty: "easy",
		Calories: 460, Protein: 16, Carbs: 66, Fiber: 3,
		MealSlots:  []string{"lunch", "dinner"},
		Categories: []string{"quick"},
		Goals:      []string{"balanced"},
		Tags:       []string{"剩饭改造", "快手菜"},
		Allergens:  []string{"鸡蛋", "大豆"},
		Ingredients: []httpapi.RecipeIngredient{
			ing("隔夜米饭", "2 碗", "staple"),
			ing("鸡蛋", "2 个", "protein"),
			ing("小葱", "2 根", "produce"),
			ing("酱油", "1 茶匙", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("炒蛋", "蛋液下锅炒散盛出。", 0),
			step("炒饭", "米饭下锅压散炒到粒粒分明。", 5),
			step("合并", "倒回鸡蛋，沿锅边淋酱油，撒葱花。", 0),
		},
	},
	{
		ID: "rcp_tofu_soup", Title: "菌菇豆腐汤",
		Summary:  "煮一锅热汤，配什么主食都合适。",
		Servings: 3, Minutes: 18, Difficulty: "easy",
		Calories: 150, Protein: 12, Carbs: 10, Fiber: 4,
		MealSlots:  []string{"dinner"},
		Categories: []string{"seasonal", "steady_sugar"},
		Goals:      []string{"steady_sugar", "fat_loss"},
		Tags:       []string{"清淡", "素食可"},
		Allergens:  []string{"大豆"},
		Ingredients: []httpapi.RecipeIngredient{
			ing("嫩豆腐", "1 盒", "protein"),
			ing("香菇", "6 朵", "produce"),
			ing("生姜", "2 片", "produce"),
			ing("盐", "适量", "seasoning"),
		},
		Steps: []httpapi.RecipeStep{
			step("煮汤底", "姜片和香菇下水，煮开转小火。", 8),
			step("下豆腐", "豆腐切块滑进去，别搅，避免碎。", 5),
			step("调味", "关火前加盐。", 0),
		},
	},
}

// seedRecipeContent 写入示例菜谱。
//
// 菜谱不属于任何用户，但 InTx 需要一个身份来设置 RLS 上下文；
// 这张表本身不受 RLS 约束，传演示用户只是为了复用同一条事务通道。
func seedRecipeContent(ctx context.Context, db *database.DB, userID string) error {
	return db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		for _, r := range seedRecipes {
			ingredients, err := json.Marshal(r.Ingredients)
			if err != nil {
				return err
			}
			steps, err := json.Marshal(r.Steps)
			if err != nil {
				return err
			}

			summary := r.Summary
			credit := "暂无图片"
			if err := q.UpsertRecipe(ctx, dbgen.UpsertRecipeParams{
				ID:              r.ID,
				Title:           r.Title,
				Summary:         &summary,
				ImageUrl:        nil,
				Servings:        r.Servings,
				DurationMinutes: r.Minutes,
				Difficulty:      r.Difficulty,
				Calories:        r.Calories,
				ProteinG:        r.Protein,
				CarbsG:          r.Carbs,
				// 示例内容是手写的，有膳食纤维没有脂肪。
				// 取地址而不是传 0：没有的那项要留空。
				FiberG:         fiberOf(r),
				MealSlots:      r.MealSlots,
				Categories:     r.Categories,
				Goals:          r.Goals,
				Tags:           r.Tags,
				Allergens:      r.Allergens,
				Ingredients:    ingredients,
				Steps:          steps,
				SourceName:     "AI事管家示例内容",
				License:        "平台自有内容",
				ImageCredit:    &credit,
				ContentVersion: "sample-v1",
			}); err != nil {
				return err
			}
		}
		log.Printf("示例菜谱：%d 条（占位内容，正式菜谱需先确定来源与授权）", len(seedRecipes))
		return nil
	})
}

// fiberOf 返回示例菜谱的膳食纤维。
//
// 手写内容有这一项，导入的内容没有——两边各自如实填，
// 缺的那项留空而不是填 0。
func fiberOf(r recipeSeed) *float64 {
	value := r.Fiber
	return &value
}
