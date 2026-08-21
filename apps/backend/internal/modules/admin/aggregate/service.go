// Package aggregate 生成后台的读模型。
//
// **它以 steward_app 身份运行，同样绕不过行级安全。** 每个用户的明细
// 都在他自己的 RLS 事务里读，读完只把脱敏后的聚合结果写进 admin schema。
//
// 代价是慢：一千个用户就是一千次事务。换来的是「后台看得到统计，
// 但没有任何一条代码路径能一次性读到所有人的原始数据」。
package aggregate

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// PhoneHashVersion 是手机号查询散列的版本。
//
// 换密钥或换归一化方式时必须递增它，否则旧散列会被当成有效值继续比对，
// 结果是「查得到但查不对」——比查不到更糟。
const PhoneHashVersion = 1

// Service 负责生成读模型。
type Service struct {
	db     *database.DB
	costs  *costs.Service
	logger *slog.Logger
	// phoneKey 用于算手机号的查询散列。和其他密钥分开：
	// 它的轮换会让所有已存散列失效，不该被别的用途牵着走。
	phoneKey []byte
	// timezone 是后台报表时区，所有日报按它切日。
	timezone string
}

// New 构造服务。
func New(db *database.DB, cost *costs.Service, phoneKey []byte, timezone string,
	logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}
	return &Service{db: db, costs: cost, phoneKey: phoneKey, timezone: timezone, logger: logger}
}

// userRow 是枚举出来的用户，只含聚合需要的字段。
type userRow struct {
	ID            string
	Phone         string
	DisplayName   string
	Timezone      string
	Initialized   bool
	CreatedAt     time.Time
	AccountStatus string
}

// listUsers 枚举用户。
//
// 走 SECURITY DEFINER 函数而不是给聚合任务 BYPASSRLS：能力被限定成一个
// 具体的函数签名，它只返回这几个字段，返回不了别的。
//
// 手写 pgx 是因为 sqlc 推不出 RETURNS TABLE 的列类型（会退化成 interface{}），
// 和登录前那几个查询是同一处理。
func (s *Service) listUsers(ctx context.Context, afterID string, limit int) ([]userRow, error) {
	var out []userRow
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx,
			`SELECT id, phone, display_name, timezone, initialized, created_at, account_status
			   FROM admin_list_users_for_aggregation($1, $2)`, limit, afterID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u userRow
			if err := rows.Scan(&u.ID, &u.Phone, &u.DisplayName, &u.Timezone,
				&u.Initialized, &u.CreatedAt, &u.AccountStatus); err != nil {
				return err
			}
			out = append(out, u)
		}
		return rows.Err()
	})
	return out, err
}

// RunDaily 生成某一天的日报，并刷新用户索引。
//
// **幂等**：同一天重跑多少遍结果都一样。聚合写的是整行覆盖而不是累加，
// 因此补跑历史、重试失败都安全。
func (s *Service) RunDaily(ctx context.Context, day time.Time) (int, error) {
	runID := idgen.New(idgen.PrefixAggregationRun)

	if err := s.startRun(ctx, runID, "daily_usage", &day); err != nil {
		return 0, err
	}

	written, err := s.aggregateAll(ctx, day)
	status, errClass := "succeeded", ""
	if err != nil {
		status, errClass = "failed", "aggregate_failed"
		s.logger.Error("后台日聚合失败", "date", day.Format("2006-01-02"), "error", err)
	}
	s.finishRun(ctx, runID, status, errClass, written)
	return written, err
}

func (s *Service) aggregateAll(ctx context.Context, day time.Time) (int, error) {
	const pageSize = 200
	afterID := ""
	written := 0

	// 清扫的基准时刻。整轮跑完后，updated_at 还停在这之前的行
	// 就是这一轮没被枚举到的用户——他们已经从 users 里消失了。
	runStartedAt := time.Now()

	for {
		users, err := s.listUsers(ctx, afterID, pageSize)
		if err != nil {
			// 枚举失败就**不清扫**：没轮到的用户会被当成已删除清掉。
			return written, err
		}
		if len(users) == 0 {
			s.pruneMissing(ctx, runStartedAt)
			return written, nil
		}
		for _, u := range users {
			if err := s.aggregateUser(ctx, u, day); err != nil {
				// 单个用户失败不该拖垮整批：记下来继续。
				// 否则一个坏数据能让整个后台永远看不到新数据。
				s.logger.Warn("聚合单个用户失败", "user_id", u.ID, "error", err)
				// **但仍要标记他还在。** 枚举到了就说明这个人存在，
				// 统计算失败是另一回事；不标记的话下面的清扫会把他删掉，
				// 一次临时故障就能抹掉一批真实用户的索引。
				s.touch(ctx, u.ID)
				continue
			}
			written++
		}
		afterID = users[len(users)-1].ID
	}
}

// touch 标记用户仍然存在，不动统计值。
func (s *Service) touch(ctx context.Context, userID string) {
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.TouchUserIndex(ctx, userID)
	})
	if err != nil {
		s.logger.Warn("标记用户存在失败", "user_id", userID, "error", err)
	}
}

// pruneMissing 清掉本轮没枚举到的用户。
//
// 读模型原先只增不减：用户从 users 里删掉之后，索引行永远留着。
// 后果是后台列表一直显示不存在的人，总用户数永远虚高，
// 点进去还会因为业务表里没有这一行而报错。
//
// **只在整轮枚举成功之后调用**，调用点就在 listUsers 返回空页那里。
func (s *Service) pruneMissing(ctx context.Context, runStartedAt time.Time) {
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		removed, err := q.PruneUserIndex(ctx, runStartedAt)
		if err != nil {
			return err
		}
		if removed > 0 {
			usage, err := q.PruneUserDailyUsage(ctx)
			if err != nil {
				return err
			}
			s.logger.Info("清掉已删除用户的读模型行",
				"user_index", removed, "user_daily_usage", usage)
		}
		return nil
	})
	if err != nil {
		// 清扫失败不影响这一轮的聚合结果，下一轮会再试。
		s.logger.Warn("清扫读模型失败", "error", err)
	}
}

// aggregateUser 聚合一个用户。
func (s *Service) aggregateUser(ctx context.Context, u userRow, day time.Time) error {
	// 先把这个用户待算的成本结掉，日聚合才拿得到金额。
	if _, err := s.costs.SettleForUser(ctx, u.ID, 500); err != nil {
		return err
	}

	var facts dbgen.UserDailyFactsRow
	var usage dbgen.UserDailyAICostRow

	err := s.db.InTx(ctx, u.ID, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		facts, err = q.UserDailyFacts(ctx, dbgen.UserDailyFactsParams{Tz: s.timezone, Day: day})
		if err != nil {
			return err
		}
		usage, err = q.UserDailyAICost(ctx, dbgen.UserDailyAICostParams{Tz: s.timezone, Day: day})
		return err
	})
	if err != nil {
		return err
	}

	// 「活跃」的口径是产生过有效业务行为。
	// **刷新令牌、轮询、健康检查都不算**——否则一个开着页面的客户端
	// 会把自己刷成日活，日活这个指标就没意义了。
	active := facts.CaptureSubmitted > 0 || facts.CaptureConfirmed > 0 ||
		facts.TaskCompleted > 0 || facts.AssistantTurns > 0 ||
		facts.ProposalExecuted > 0 || facts.ReviewGenerated > 0

	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.UpsertUserDailyUsage(ctx, dbgen.UpsertUserDailyUsageParams{
			UserID: u.ID, ReportDate: day, Active: active,
			CaptureSubmitted:    int32(facts.CaptureSubmitted),
			CaptureConfirmed:    int32(facts.CaptureConfirmed),
			TaskCompleted:       int32(facts.TaskCompleted),
			AssistantTurns:      int32(facts.AssistantTurns),
			ProposalExecuted:    int32(facts.ProposalExecuted),
			ReviewGenerated:     int32(facts.ReviewGenerated),
			AiInputTokens:       usage.InputTokens,
			AiCachedInputTokens: usage.CachedInputTokens,
			AiOutputTokens:      usage.OutputTokens,
			AiCost:              usage.Cost,
			AiCostStatus:        usage.CostStatus,
		})
	})
	if err != nil {
		return err
	}
	return s.refreshIndex(ctx, u)
}

// rollingStats 是近 30 天的滚动统计。
type rollingStats struct {
	ActiveDays int32
	Cost       pgtype.Numeric
	CostStatus string
	LastActive *time.Time
}

// rollingFor 算某个用户近 30 天的活跃天数与成本。
//
// 手写 pgx 而不是走 sqlc：`max(...) FILTER (WHERE ...)` 的可空性 sqlc 推不出来。
// 加 cast 会被当成非空，遇到「一天都没活跃过」的用户直接扫描失败；
// 不加 cast 又退化成 interface{}。这类查询本来就该手写，CLAUDE.md 里记着。
func (s *Service) rollingFor(ctx context.Context, userID string) (rollingStats, error) {
	var out rollingStats
	since := time.Now().AddDate(0, 0, -30)

	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			SELECT
			    count(*) FILTER (WHERE active)::int,
			    (sum(ai_cost))::numeric,
			    CASE
			        WHEN count(*) FILTER (WHERE ai_cost_status <> 'no_usage') = 0 THEN 'no_usage'
			        WHEN count(*) FILTER (WHERE ai_cost_status IN ('pricing_missing','partial')) = 0 THEN 'calculated'
			        WHEN count(*) FILTER (WHERE ai_cost_status IN ('calculated','partial')) = 0 THEN 'pricing_missing'
			        ELSE 'partial'
			    END,
			    max(report_date) FILTER (WHERE active)
			FROM admin.user_daily_usage
			WHERE user_id = $1 AND report_date > $2`, userID, since).
			Scan(&out.ActiveDays, &out.Cost, &out.CostStatus, &out.LastActive)
	})
	return out, err
}

// refreshIndex 刷新用户索引。
func (s *Service) refreshIndex(ctx context.Context, u userRow) error {
	rolling, err := s.rollingFor(ctx, u.ID)
	if err != nil {
		return err
	}

	// 一天都没活跃过时是 NULL，不是某个默认日期——
	// 写成 0001-01-01 的话界面上会显示出一个荒谬的时间。
	lastActive := rolling.LastActive

	return s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.UpsertUserIndex(ctx, dbgen.UpsertUserIndexParams{
			UserID: u.ID,
			// **只存脱敏号码。** 后台任何界面都不显示完整手机号。
			MaskedPhone:      MaskPhone(u.Phone),
			PhoneLookupHash:  s.phoneHash(u.Phone),
			PhoneHashVersion: PhoneHashVersion,
			DisplayName:      u.DisplayName,
			AccountStatus:    u.AccountStatus,
			Initialized:      u.Initialized,
			Timezone:         u.Timezone,
			CreatedAt:        u.CreatedAt,
			LastActiveAt:     lastActive,
			ActiveDays30d:    rolling.ActiveDays,
			AiCost30d:        rolling.Cost,
			AiCostStatus:     rolling.CostStatus,
			SourceVersion:    1,
		})
	})
}

// phoneHash 算手机号的查询散列。
//
// 用 HMAC 而不是裸散列：手机号的取值空间只有一百多亿，裸 SHA-256
// 可以在几分钟内被穷举反查出来。带密钥之后，没有密钥就算不出来。
func (s *Service) phoneHash(phone string) []byte {
	if phone == "" || len(s.phoneKey) == 0 {
		return nil
	}
	mac := hmac.New(sha256.New, s.phoneKey)
	mac.Write([]byte(phone))
	return mac.Sum(nil)
}

// PhoneHashFor 供后台按手机号精确查询时算同一个散列。
func PhoneHashFor(phone string, key []byte) []byte {
	if phone == "" || len(key) == 0 {
		return nil
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(phone))
	return mac.Sum(nil)
}

// MaskPhone 把手机号脱敏成 138****8000。
//
// 保留头三位与末四位：够运营辨认「是不是这个人」，又拼不回完整号码。
func MaskPhone(phone string) string {
	runes := []rune(phone)
	if len(runes) <= 7 {
		// 太短就整体打码，不做「保留几位」的猜测。
		return "****"
	}
	return string(runes[:3]) + "****" + string(runes[len(runes)-4:])
}

func (s *Service) startRun(ctx context.Context, id, kind string, reportDate *time.Time) error {
	return s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.StartAggregationRun(ctx, dbgen.StartAggregationRunParams{
			ID: id, Kind: kind, ReportDate: reportDate,
		})
		return err
	})
}

func (s *Service) finishRun(ctx context.Context, id, status, errClass string, rows int) {
	now := time.Now()
	var class *string
	if errClass != "" {
		class = &errClass
	}
	var asOf *time.Time
	if status == "succeeded" {
		asOf = &now
	}
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		return q.FinishAggregationRun(ctx, dbgen.FinishAggregationRunParams{
			ID: id, Status: status, DataAsOf: asOf,
			ErrorClass: class, RowsWritten: int32(rows),
		})
	})
	if err != nil {
		s.logger.Error("记录聚合结果失败", "run_id", id, "error", err)
	}
}
