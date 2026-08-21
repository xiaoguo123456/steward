package aggregate

import (
	"context"
	"io"

	"log/slog"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/admin/costs"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 读模型必须跟着源表收缩，不能只增不减。
//
// 这条守着一个真实踩过的坑：聚合里只有 upsert，没有任何删除。
// 用户从 users 里删掉之后索引行永远留着，后果是后台列表一直显示
// 不存在的人、总用户数永远虚高，点进去还会因为业务表里查不到而报错。
// 实测时后台报 993 个用户，库里实际只有 73 个。
func TestAggregationPrunesDeletedUsers(t *testing.T) {
	svc, db := testService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	userID := seedUser(t, db)
	day := time.Now()

	if _, err := svc.RunDaily(ctx, day); err != nil {
		t.Fatalf("首次聚合失败：%v", err)
	}
	if !indexHas(t, db, userID) {
		t.Fatal("聚合之后索引里应当有这个用户")
	}

	deleteUser(t, db, userID)

	if _, err := svc.RunDaily(ctx, day); err != nil {
		t.Fatalf("二次聚合失败：%v", err)
	}
	if indexHas(t, db, userID) {
		t.Fatal("用户已从 users 删除，聚合之后索引里不该还留着")
	}
	if usageHas(t, db, userID) {
		t.Fatal("日报也该跟着索引一起清掉")
	}
}

// 存活的用户不能被清扫误伤。
//
// 清扫按「这一轮有没有被碰过」判断，写错方向就会把所有人删光——
// 而那种错误在只有一个用户的测试里看不出来，必须有对照组。
func TestAggregationKeepsLiveUsers(t *testing.T) {
	svc, db := testService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	stays := seedUser(t, db)
	goes := seedUser(t, db)
	day := time.Now()

	if _, err := svc.RunDaily(ctx, day); err != nil {
		t.Fatalf("首次聚合失败：%v", err)
	}
	deleteUser(t, db, goes)
	if _, err := svc.RunDaily(ctx, day); err != nil {
		t.Fatalf("二次聚合失败：%v", err)
	}

	if !indexHas(t, db, stays) {
		t.Error("还存在的用户被清扫误删了")
	}
	if indexHas(t, db, goes) {
		t.Error("已删除的用户没有被清掉")
	}
}

func testService(t *testing.T) (*Service, *database.DB) {
	t.Helper()
	dsn := config.LoadForTest().DatabaseURL
	if dsn == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过读模型清扫测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("连接失败：%v", err)
	}
	t.Cleanup(db.Close)

	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(db, costs.New(db, quiet), []byte("测试用的手机号散列密钥"), "Asia/Shanghai", quiet), db
}

func seedUser(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := "196" + time.Now().Format("05.000000")[:8]
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "清扫测试", "Asia/Shanghai").Scan(&userID)
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

// deleteUser 真的删掉用户。
//
// **必须走 InTx 而不是 InTxAnonymous。** users 表是 FORCE ROW LEVEL SECURITY 的，
// 匿名事务里没有 app.user_id，DELETE 一行都匹配不到——而且不报错，
// 返回 0 行影响。第一版就是这么写的，测试于是在验证一个从没发生过的删除。
func deleteUser(t *testing.T, db *database.DB, userID string) {
	t.Helper()
	var affected int64
	err := db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID)
		if err != nil {
			return err
		}
		affected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		t.Fatalf("删除测试用户失败：%v", err)
	}
	// 删了 0 行说明 RLS 把这条语句悄悄挡掉了，后面的断言全都没有意义。
	if affected != 1 {
		t.Fatalf("应当删掉 1 个用户，实际 %d——检查事务里有没有设 app.user_id", affected)
	}
}

func indexHas(t *testing.T, db *database.DB, userID string) bool {
	t.Helper()
	return countBy(t, db,
		"SELECT count(*) FROM admin.user_index WHERE user_id = $1", userID) > 0
}

func usageHas(t *testing.T, db *database.DB, userID string) bool {
	t.Helper()
	return countBy(t, db,
		"SELECT count(*) FROM admin.user_daily_usage WHERE user_id = $1", userID) > 0
}

func countBy(t *testing.T, db *database.DB, sql, userID string) int {
	t.Helper()
	var n int
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, sql, userID).Scan(&n)
	})
	if err != nil {
		t.Fatalf("查读模型失败：%v", err)
	}
	return n
}
