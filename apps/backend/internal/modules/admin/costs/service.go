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

	// 重算前先清空。**不这么做就不幂等**：补了价格重跑一次，
	// 成本会变成两倍。
	if err := q.DeleteCostItems(ctx, row.ID); err != nil {
		return err
	}

	units := []struct {
		unit     string
		quantity int32
	}{
		{UnitInputToken, row.InputTokens},
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
	price, err := numericOf(p.UnitPriceUSD)
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
			UnitPriceUsd:   price,
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
	UnitPriceUSD   string
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
