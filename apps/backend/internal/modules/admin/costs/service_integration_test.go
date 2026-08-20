package costs

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 成本核算的集成测试。
//
// 守的核心只有一条：**没有价格时金额是 NULL，不是 0。**
// 「不知道多少钱」和「不花钱」是完全不同的两件事，混成 0 会让所有成本
// 报表系统性偏低，而且从数字本身看不出偏低。
//
// 金额全程走 numeric，不经过 float64——这是钱，差一点点也不行。

func testDB(t *testing.T) *database.DB {
	t.Helper()
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过成本集成测试")
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

// seedUser 造一个用户。ai_actions 受 RLS 约束，必须有真实用户才写得进去。
func seedUser(t *testing.T, db *database.DB) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	phone := "199" + time.Now().Format("05.000000")[:8]

	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "成本测试", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	t.Cleanup(func() {
		_ = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID)
			return err
		})
	})
	return userID
}

// seedAction 写一条 AI 调用记录。
func seedAction(t *testing.T, db *database.DB, userID, provider, model string,
	in, cached, out int32, at time.Time) string {
	t.Helper()

	id := idgen.New(idgen.PrefixAIAction)
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.RecordAiAction(ctx, dbgen.RecordAiActionParams{
			ID: id, UserID: userID, Feature: "capture", RunID: "run_test",
			EngineType: "single_shot", Provider: provider, ModelPolicy: "parse",
			ProviderModel: model, InputRefs: []byte("[]"), Status: "succeeded",
			InputTokens: in, CachedInputTokens: cached, OutputTokens: out,
		}); err != nil {
			return err
		}
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// 时间要能指定，才测得出「按调用时刻匹配价格版本」。
		_, err = tx.Exec(ctx, "UPDATE ai_actions SET created_at = $1 WHERE id = $2", at, id)
		return err
	})
	if err != nil {
		t.Fatalf("写入调用记录失败：%v", err)
	}
	return id
}

// uniqueProvider 给每个测试一个独一无二的服务商名。
//
// 价格表上有「生效区间不重叠」的排他约束，固定名字会让**第二次运行**
// 撞上第一次留下的数据。只在干净库上能过的测试不算测试——
// 它会在 CI 上时灵时不灵，而且失败原因和被测逻辑毫无关系。
func uniqueProvider(t *testing.T) string {
	t.Helper()
	return "test-" + strings.ToLower(t.Name()) + "-" + idgen.New("p")
}

func addPrice(t *testing.T, svc *Service, provider, model, unit, size, price string,
	from time.Time, until *time.Time) string {
	t.Helper()
	row, err := svc.AddPrice(context.Background(), PriceInput{
		Provider: provider, Model: model, UsageUnit: unit,
		UnitSize: size, UnitPriceUSD: price,
		EffectiveFrom: from, EffectiveUntil: until,
	})
	if err != nil {
		t.Fatalf("新增价格失败：%v", err)
	}
	t.Cleanup(func() {
		_ = svc.db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "DELETE FROM ai_model_prices WHERE id = $1", row.ID)
			return err
		})
	})
	return row.ID
}

// 读回一条调用的成本与状态。
func actionCost(t *testing.T, db *database.DB, userID, actionID string) (string, string) {
	t.Helper()
	var cost, status string
	err := db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT coalesce(estimated_cost::text, ''), cost_status FROM ai_actions WHERE id = $1",
			actionID).Scan(&cost, &status)
	})
	if err != nil {
		t.Fatalf("读取成本失败：%v", err)
	}
	return cost, status
}

// 没有价格时金额是 NULL，**不是 0**。
func TestNoPriceMeansNullNotZero(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	id := seedAction(t, db, userID, uniqueProvider(t), "model-x", 1000, 0, 500, time.Now())
	if _, err := svc.SettleForUser(context.Background(), userID, 100); err != nil {
		t.Fatalf("结算失败：%v", err)
	}

	cost, status := actionCost(t, db, userID, id)
	if cost != "" {
		t.Errorf("没有价格时金额应当为空，实际 %q——0 会被读成「这次不花钱」", cost)
	}
	if status != "pricing_missing" {
		t.Errorf("状态应当是 pricing_missing，实际 %q", status)
	}
}

// 有价格时按 quantity / unit_size * unit_price 精确计算。
func TestCostIsComputedExactly(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	provider, model := uniqueProvider(t), "model-exact"
	from := time.Now().Add(-24 * time.Hour)
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00250", from, nil)
	addPrice(t, svc, provider, model, UnitOutputToken, "1000", "0.01000", from, nil)
	addPrice(t, svc, provider, model, UnitCachedInputToken, "1000", "0.00025", from, nil)

	// 1000 输入 = 0.0025，200 输出 = 0.002，400 缓存 = 0.0001，合计 0.0046
	id := seedAction(t, db, userID, provider, model, 1000, 400, 200, time.Now())
	if _, err := svc.SettleForUser(context.Background(), userID, 100); err != nil {
		t.Fatalf("结算失败：%v", err)
	}

	cost, status := actionCost(t, db, userID, id)
	if status != "calculated" {
		t.Fatalf("三项都有价，状态应当是 calculated，实际 %q", status)
	}
	// 用字符串比较：走一趟 float64 就已经不是这个数了。
	if cost != "0.00460000" {
		t.Errorf("金额应当是 0.00460000，实际 %q", cost)
	}
}

// 部分单位有价、部分没有时，状态是 partial，**已算出的那部分要保留**。
//
// 报成 pricing_missing 并把金额丢掉的话，界面会显示「价格缺失」，
// 而那笔真实花掉的钱就从账上消失了。
func TestPartialPricingKeepsKnownAmount(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	provider, model := uniqueProvider(t), "model-partial"
	// 只给输入 token 配价，输出不配。
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00200",
		time.Now().Add(-24*time.Hour), nil)

	id := seedAction(t, db, userID, provider, model, 2000, 0, 500, time.Now())
	if _, err := svc.SettleForUser(context.Background(), userID, 100); err != nil {
		t.Fatalf("结算失败：%v", err)
	}

	cost, status := actionCost(t, db, userID, id)
	if status != "partial" {
		t.Errorf("一部分有价一部分没有，状态应当是 partial，实际 %q", status)
	}
	if cost != "0.00400000" {
		t.Errorf("已算出的部分应当保留（2000/1000*0.002=0.004），实际 %q", cost)
	}
}

// 重复结算必须幂等：成本不会翻倍。
//
// 补上一个缺失的价格之后要重跑，重跑不幂等的话账目会越跑越大。
func TestSettlingIsIdempotent(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	provider, model := uniqueProvider(t), "model-idem"
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00300",
		time.Now().Add(-24*time.Hour), nil)

	id := seedAction(t, db, userID, provider, model, 1000, 0, 0, time.Now())
	ctx := context.Background()

	if _, err := svc.SettleForUser(ctx, userID, 100); err != nil {
		t.Fatal(err)
	}
	first, _ := actionCost(t, db, userID, id)

	// 标回待算再跑一遍，模拟「补了价格之后重算」。
	err := db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE ai_actions SET cost_status='pending' WHERE id=$1", id)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SettleForUser(ctx, userID, 100); err != nil {
		t.Fatal(err)
	}
	second, _ := actionCost(t, db, userID, id)

	if first != second {
		t.Errorf("重算结果变了：%q → %q，说明成本被累加了", first, second)
	}
}

// 价格按**调用发生的时刻**匹配，不是按现在的价。
//
// 否则改一次价，历史账目全跟着变——上个月的报表这个月一看是另一个数，
// 那份报表就没有任何意义了。
func TestPriceIsMatchedByCallTime(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	provider, model := uniqueProvider(t), "model-history"
	cutover := time.Now().Add(-48 * time.Hour)
	// 旧价到 cutover 为止，新价从 cutover 开始。
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00100",
		time.Now().Add(-96*time.Hour), &cutover)
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00500", cutover, nil)

	oldCall := seedAction(t, db, userID, provider, model, 1000, 0, 0, time.Now().Add(-72*time.Hour))
	newCall := seedAction(t, db, userID, provider, model, 1000, 0, 0, time.Now())

	if _, err := svc.SettleForUser(context.Background(), userID, 100); err != nil {
		t.Fatal(err)
	}

	oldCost, _ := actionCost(t, db, userID, oldCall)
	newCost, _ := actionCost(t, db, userID, newCall)

	if oldCost != "0.00100000" {
		t.Errorf("旧调用应当按旧价 0.001 算，实际 %q", oldCost)
	}
	if newCost != "0.00500000" {
		t.Errorf("新调用应当按新价 0.005 算，实际 %q", newCost)
	}
}

// 用量为 0 的单位记为 not_applicable，不是 pricing_missing。
//
// 这次调用就没用到这个单位，谈不上缺价——混为一谈会让「有多少调用缺价」
// 这个指标永远高得没法看。
func TestZeroQuantityIsNotApplicable(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)
	userID := seedUser(t, db)

	provider, model := uniqueProvider(t), "model-zero"
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.00100",
		time.Now().Add(-24*time.Hour), nil)
	addPrice(t, svc, provider, model, UnitOutputToken, "1000", "0.00200",
		time.Now().Add(-24*time.Hour), nil)

	// 缓存 token 为 0，且没有配价。
	id := seedAction(t, db, userID, provider, model, 500, 0, 100, time.Now())
	if _, err := svc.SettleForUser(context.Background(), userID, 100); err != nil {
		t.Fatal(err)
	}

	_, status := actionCost(t, db, userID, id)
	if status != "calculated" {
		t.Errorf("用量为 0 的单位不该拖累状态，应当是 calculated，实际 %q", status)
	}
}

// 生效区间不允许重叠，由数据库约束保证。
//
// 重叠了就会出现「同一次调用能匹配到两个价格」，
// 那时算出来的数字取决于查询的排序，等于不确定。
func TestOverlappingPricesAreRejected(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)

	provider, model := uniqueProvider(t), "model-overlap"
	base := time.Now().Add(-72 * time.Hour)
	addPrice(t, svc, provider, model, UnitInputToken, "1000", "0.001", base, nil)

	_, err := svc.AddPrice(context.Background(), PriceInput{
		Provider: provider, Model: model, UsageUnit: UnitInputToken,
		UnitSize: "1000", UnitPriceUSD: "0.002",
		EffectiveFrom: base.Add(time.Hour),
	})
	if err == nil {
		t.Error("生效区间重叠的价格应当被拒绝")
	}
}

// 金额字符串不合法时明确报错，不静默当成 0。
func TestInvalidAmountIsRejected(t *testing.T) {
	db := testDB(t)
	svc := New(db, nil)

	_, err := svc.AddPrice(context.Background(), PriceInput{
		Provider: uniqueProvider(t), Model: "m", UsageUnit: UnitInputToken,
		UnitSize: "1000", UnitPriceUSD: "不是数字",
		EffectiveFrom: time.Now(),
	})
	if err == nil {
		t.Error("非法金额应当被拒绝，而不是当成 0")
	}
}
