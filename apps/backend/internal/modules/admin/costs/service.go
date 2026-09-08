// Package costs 把 AI 调用的用量换算成金额。
//
// **换算全部在 SQL 里用 numeric 完成**，Go 只负责搬字符串。
// 用 float64 搬一趟就会有舍入误差，而这是钱——一年下来的账对不上，
// 又找不到是哪一笔错了。
//
// 核心规则只有一条：**没有价格时金额是 NULL，不是 0。**
// 「不知道多少钱」和「不花钱」是完全不同的两件事，混成 0 会让所有成本
// 报表系统性偏低，而且从数字本身看不出偏低。
package costs

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 用量单位。取值必须落在 ai_model_prices_unit_check 之内。
const (
	UnitInputToken       = "input_token"
	UnitCachedInputToken = "cached_input_token"
	UnitOutputToken      = "output_token"
	UnitAudioSecond      = "audio_second"
	UnitImage            = "image"
	UnitRequest          = "request"
)

// Service 负责成本落账。
type Service struct {
	db     *database.DB
	logger *slog.Logger
}

// New 构造服务。
func New(db *database.DB, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{db: db, logger: logger}
}

// SettleForUser 给某个用户还没算成本的调用落账。
//
// 按用户来是因为 ai_actions 受 RLS 约束：跨用户扫表需要
// BYPASSRLS，而那正是这套设计要避免的。逐个用户开事务虽然多几次往返，
// 但换来的是「聚合任务也绕不过行级安全」。
func (s *Service) SettleForUser(ctx context.Context, userID string, limit int32) (int, error) {
	if limit <= 0 || limit > 5000 {
		limit = 500
	}

	settled := 0
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListPendingCostActions(ctx, limit)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := s.settleOne(ctx, q, row); err != nil {
				return err
			}
			settled++
		}
		return nil
	})
	return settled, err
}

// settleOne 给一次调用写明细并汇总。
func (s *Service) settleOne(ctx context.Context, q *dbgen.Queries,
	row dbgen.ListPendingCostActionsRow) error {
	// Provider 的输入总量已包含缓存命中部分，不能再按普通输入单价重复收费。
	if row.InputTokens < 0 || row.CachedInputTokens < 0 || row.OutputTokens < 0 || row.CachedInputTokens > row.InputTokens {
		return fmt.Errorf("调用用量无效：缓存输入必须处于输入总量范围内，Token 数不能为负")
	}

	// 重算前先清空。**不这么做就不幂等**：补了价格重跑一次，
	// 成本会变成两倍。
	if err := q.DeleteCostItems(ctx, row.ID); err != nil {
		return err
	}

	units := []struct {
		unit     string
		quantity int32
	}{
		{UnitInputToken, row.InputTokens - row.CachedInputTokens},
		{UnitCachedInputToken, row.CachedInputTokens},
		{UnitOutputToken, row.OutputTokens},
	}
	for _, u := range units {
		quantity, err := numericOf(fmt.Sprintf("%d", u.quantity))
		if err != nil {
			return err
		}
		if err := q.InsertCostItem(ctx, dbgen.InsertCostItemParams{
			ID:         idgen.New(idgen.PrefixAICostItem),
			AiActionID: row.ID,
			UsageUnit:  u.unit,
			Quantity:   quantity,
			Provider:   row.Provider,
			Model:      row.ProviderModel,
			OccurredAt: row.CreatedAt,
		}); err != nil {
			return err
		}
	}
	return q.RollupActionCost(ctx, row.ID)
}

// AddPrice 新增一个价格版本。
//
// **不覆盖旧值。** 覆盖会让历史账目跟着变——上个月按旧价算出来的成本，
// 这个月一看变了，那份报表就没有任何意义了。
//
// 新增之后把这个 Provider + 模型下的调用标回待算，让它们用新价重算。
func (s *Service) AddPrice(ctx context.Context, p PriceInput) (dbgen.AiModelPrice, error) {
	size, err := numericOf(p.UnitSize)
	if err != nil {
		return dbgen.AiModelPrice{}, err
	}
	price, err := numericOf(p.UnitPriceCNY)
	if err != nil {
		return dbgen.AiModelPrice{}, err
	}

	var out dbgen.AiModelPrice
	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.UpsertAIPrice(ctx, dbgen.UpsertAIPriceParams{
			ID:             idgen.New(idgen.PrefixAIPrice),
			Provider:       p.Provider,
			Model:          p.Model,
			UsageUnit:      p.UsageUnit,
			UnitSize:       size,
			UnitPriceCny:   price,
			EffectiveFrom:  p.EffectiveFrom,
			EffectiveUntil: p.EffectiveUntil,
		})
		if err != nil {
			return err
		}
		out = row
		return nil
	})
	return out, err
}

// PriceInput 是新增价格的入参。金额用字符串传，不经过 float64。
type PriceInput struct {
	Provider       string
	Model          string
	UsageUnit      string
	UnitSize       string
	UnitPriceCNY   string
	EffectiveFrom  time.Time
	EffectiveUntil *time.Time
}

// numericOf 把十进制字符串转成 pgtype.Numeric。
//
// **不经过 float64。** pgtype.Numeric 内部是「整数尾数 + 指数」，
// 从字符串解析是精确的；而 "0.1" 走一趟 float64 就已经不是 0.1 了。
// 这是钱，差一点点也不行。
func numericOf(value string) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(value); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("金额 %q 不是合法的十进制数：%w", value, err)
	}
	return n, nil
}

// NumericString 把 pgtype.Numeric 转回字符串，供 API 返回。
//
// 空值返回空串：调用方据此判断该显示「价格缺失」还是显示金额。
func NumericString(n pgtype.Numeric) string {
	if !n.Valid {
		return ""
	}
	value, err := n.Value()
	if err != nil || value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

// SumAmounts 精确累加一组十进制金额字符串。
//
// **不经过 float64。** 累加是后台唯一在 Go 里做的金额运算，
// 而 0.1 + 0.2 在 float64 下等于 0.30000000000000004——
// 一份对不上的账单比没有账单更糟，因为你会先怀疑别的地方。
//
// 任何一项解析不出来就返回 false，让调用方报「算不出来」而不是报一个错的数。
func SumAmounts(values []string) (string, bool) {
	if len(values) == 0 {
		return "", false
	}
	total := new(big.Rat)
	for _, v := range values {
		parsed, ok := new(big.Rat).SetString(strings.TrimSpace(v))
		if !ok {
			return "", false
		}
		total.Add(total, parsed)
	}
	// 保留 8 位小数，和库里 numeric(20,8) 的精度一致。
	return total.FloatString(8), true
}

// ListPrices 返回全部价格版本。
func (s *Service) ListPrices(ctx context.Context) ([]dbgen.ListAIPricesRow, error) {
	var out []dbgen.ListAIPricesRow
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		out, err = q.ListAIPrices(ctx)
		return err
	})
	return out, err
}
