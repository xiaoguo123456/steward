package readapi

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 详情接口给出的 version 必须是 users 表当前的真值。
//
// 这条守着一个真实踩过的坑：这里最初写着字面量 0，注释说「步骤四会加上」。
// 步骤四加了 status_version 列，没人回来改这一行。
//
// 后果不是「数字不好看」——管理写操作拿它做乐观锁，用户只要被写过一次，
// 之后每一次暂停/恢复都永久 409，而刷新页面只会再拿到那个 0。
// 锁装上了却不发钥匙，功能整个不可用。
//
// 集成测试才测得到：单测里 userCounts 连不上库，返回什么都看不出来。
func TestUserDetailReportsLiveStatusVersion(t *testing.T) {
	dsn := config.LoadForTest().DatabaseURL
	adminDSN := config.AdminTestDatabaseURL()
	if dsn == "" || adminDSN == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	appDB, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("连接失败：%v", err)
	}
	defer appDB.Close()

	userID := seedUserForVersion(t, appDB)
	api := NewReadAPI(appDB, config.AdminConfig{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// 新用户是 0。
	if _, _, v, status, err := api.userCounts(ctx, userID); err != nil {
		t.Fatalf("取用户明细失败：%v", err)
	} else if v != 0 || status != "active" {
		t.Fatalf("新用户应当是 version=0 active，实际 version=%d status=%s", v, status)
	}

	// 模拟一次管理写操作推进版本并改状态。
	bumpStatus(t, appDB, userID, "suspended", 3)

	_, _, v, status, err := api.userCounts(ctx, userID)
	if err != nil {
		t.Fatalf("取用户明细失败：%v", err)
	}
	if v != 3 {
		t.Fatalf("version 应当跟着 users.status_version 走，期望 3，实际 %d", v)
	}
	// 状态也必须实时读：读模型的快照会滞后，
	// 刚暂停完页面还显示「正常」，界面上的按钮就会给反。
	if status != "suspended" {
		t.Fatalf("account_status 应当实时反映，期望 suspended，实际 %s", status)
	}
}

func seedUserForVersion(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := "197" + time.Now().Format("05.000000")[:8]
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "版本测试", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	return userID
}

func bumpStatus(t *testing.T, db *database.DB, userID, status string, version int) {
	t.Helper()
	err := db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE users
			   SET account_status = $2, status_version = $3,
			       suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE NULL END
			 WHERE id = $1`, userID, status, version)
		return err
	})
	if err != nil {
		t.Fatalf("推进用户状态失败：%v", err)
	}
}
