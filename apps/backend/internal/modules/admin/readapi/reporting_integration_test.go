package readapi

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestHistoricalActivityAndOnboardingCohort(t *testing.T) {
	dsn := config.LoadForTest().DatabaseURL
	if dsn == "" {
		t.Skip("未配置集成测试数据库")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	err = db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		first, future, old := idgen.New("usr"), idgen.New("usr"), idgen.New("usr")
		for _, u := range []struct{ id, date string }{{first, "2001-02-01"}, {future, "2001-02-03"}, {old, "2000-01-01"}} {
			_, err = tx.Exec(ctx, `INSERT INTO admin.user_index(user_id,masked_phone,display_name,account_status,initialized,timezone,created_at) VALUES($1,'***','验收样本','active',true,'Asia/Shanghai',$2::date)`, u.id, u.date)
			if err != nil {
				return err
			}
		}
		for _, u := range []struct{ id, date string }{{first, "2001-02-01"}, {future, "2001-02-03"}, {old, "2001-02-03"}} {
			_, err = tx.Exec(ctx, `INSERT INTO admin.user_daily_usage(user_id,report_date,active) VALUES($1,$2::date,true)`, u.id, u.date)
			if err != nil {
				return err
			}
		}
		day, _ := time.Parse(time.DateOnly, "2001-02-01")
		metrics, err := q.AdminDashboardUsers(ctx, dbgen.AdminDashboardUsersParams{Tz: "Asia/Shanghai", FromDate: day, ToDate: day})
		if err != nil {
			return err
		}
		if metrics.Dau != 1 || metrics.Wau != 1 || metrics.Mau != 1 {
			t.Errorf("历史窗口混入未来数据：%+v", metrics)
		}
		cohort, err := q.AdminOnboardingCohort(ctx, dbgen.AdminOnboardingCohortParams{Tz: "Asia/Shanghai", FromDate: day, ToDate: day})
		if err != nil {
			return err
		}
		if cohort.Registered != 1 || cohort.Initialized != 1 || cohort.Activated != 1 {
			t.Errorf("漏斗混入窗口外用户：%+v", cohort)
		}
		_, err = tx.Exec(ctx, `DELETE FROM admin.user_daily_usage WHERE user_id=ANY($1::text[])`, []string{first, future, old})
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM admin.user_index WHERE user_id=ANY($1::text[])`, []string{first, future, old})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAdminCanReadOnlyOperationalModels(t *testing.T) {
	dsn := config.AdminTestDatabaseURL()
	if dsn == "" {
		t.Skip("未配置后台测试数据库")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	err = db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		for _, table := range []string{"admin.user_index", "admin.user_daily_usage", "admin.aggregation_runs"} {
			var read, write, bypass bool
			err = tx.QueryRow(ctx, `SELECT has_table_privilege(current_user,$1,'SELECT'),has_table_privilege(current_user,$1,'UPDATE'),rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user`, table).Scan(&read, &write, &bypass)
			if err != nil {
				return err
			}
			if !read || write || bypass {
				t.Errorf("%s 权限不符合只读隔离：read=%v write=%v bypass=%v", table, read, write, bypass)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
