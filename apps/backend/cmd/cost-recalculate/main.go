// Command cost-recalculate 按指定模型和报表日期补算成本，再刷新该日日报。
// 默认只预览数量，显式 -apply 才写入；逐个用户使用运行账号和 RLS 事务。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/aggregate"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

func main() {
	if err := run(); err != nil {
		// 不把连接串、用户标识或底层 SQL 参数输出到运维日志。
		slog.Error("成本补算失败，请核对参数、价格覆盖和数据库权限")
		os.Exit(1)
	}
}

func run() error {
	provider := flag.String("provider", "", "账本中的服务商标识")
	model := flag.String("model", "", "精确模型名称")
	dayText := flag.String("day", "", "报表日期，格式 YYYY-MM-DD")
	apply := flag.Bool("apply", false, "执行补算；省略时只预览")
	flag.Parse()
	day, err := time.Parse("2006-01-02", *dayText)
	if err != nil || *provider == "" || *model == "" {
		return errors.New("必须指定服务商、模型和日期")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	loc, err := time.LoadLocation(cfg.AdminReportingTimezone)
	if err != nil {
		return err
	}
	from := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	until := from.AddDate(0, 0, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	var bypass bool
	if err := db.Pool.QueryRow(ctx, "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user").Scan(&bypass); err != nil {
		return err
	}
	if bypass {
		return errors.New("成本补算必须使用无 BYPASSRLS 的运行账号")
	}
	svc := costs.New(db, nil)
	total := int64(0)
	after := ""
	for {
		rows, err := db.Pool.Query(ctx, "SELECT id FROM admin_list_users_for_aggregation(200, $1)", after)
		if err != nil {
			return err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			break
		}
		for _, id := range ids {
			var count int64
			err := db.InTx(ctx, id, func(ctx context.Context, _ *dbgen.Queries) error {
				tx, err := database.TxFrom(ctx)
				if err != nil {
					return err
				}
				if !*apply {
					return tx.QueryRow(ctx, "SELECT count(*) FROM ai_actions WHERE provider=$1 AND provider_model=$2 AND created_at >= $3 AND created_at < $4", *provider, *model, from, until).Scan(&count)
				}
				result, err := tx.Exec(ctx, "UPDATE ai_actions SET cost_status='pending', estimated_cost_cny=NULL, cost_calculated_at=NULL WHERE provider=$1 AND provider_model=$2 AND created_at >= $3 AND created_at < $4", *provider, *model, from, until)
				if err == nil {
					count = result.RowsAffected()
				}
				return err
			})
			if err != nil {
				return err
			}
			total += count
			if *apply && count > 0 {
				// 与小时聚合复用结算服务；其他已待算记录也会按各自原有价格版本完成结算。
				for {
					n, err := svc.SettleForUser(ctx, id, 5000)
					if err != nil {
						return err
					}
					if n < 5000 {
						break
					}
				}
			}
		}
		after = ids[len(ids)-1]
	}
	if *apply {
		agg := aggregate.New(db, svc, []byte(cfg.MemoryFingerprintKey), cfg.AdminReportingTimezone, nil)
		if _, err := agg.RunDaily(ctx, day); err != nil {
			return err
		}
	}
	fmt.Printf("模型=%s 日期=%s 匹配调用=%d 已执行=%t\n", *model, *dayText, total, *apply)
	return nil
}
