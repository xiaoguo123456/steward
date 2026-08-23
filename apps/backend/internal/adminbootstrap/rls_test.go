package adminbootstrap_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 后台数据库账号的边界测试。
//
// **这是整个后台设计里最要紧的一组。** 后台能看跨用户的统计，靠的是读
// admin schema 里的脱敏聚合表，而不是靠一个能无视行级安全的连接。
//
// 如果 steward_admin 拿到了 BYPASSRLS，后台就变成一把万能钥匙：
// 一次 SQL 注入、一个写错的 WHERE，就能横跨所有人的数据。
// RLS 是这个系统唯一的强保证，不该为了「后台方便」在它上面开洞。
//
// 没配 STEWARD_TEST_DATABASE_URL 时跳过，先跑 make migrate-test。

func openAdminDB(t *testing.T) *database.DB {
	t.Helper()
	dsn := config.AdminTestDatabaseURL()
	if dsn == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过后台数据库边界测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("以后台数据库账号连接失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

// 后台账号不能是超级用户，也不能带 BYPASSRLS。
func TestAdminRoleCannotBypassRLS(t *testing.T) {
	db := openAdminDB(t)
	poolConfig, err := pgxpool.ParseConfig(config.AdminTestDatabaseURL())
	if err != nil {
		t.Fatalf("解析后台测试数据库地址失败：%v", err)
	}
	expectedName := poolConfig.ConnConfig.User

	var isSuper, canBypass bool
	var name string
	err = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user").
			Scan(&name, &isSuper, &canBypass)
	})
	if err != nil {
		t.Fatalf("查询角色属性失败：%v", err)
	}

	if name != expectedName {
		t.Errorf("后台应当以配置账号 %s 连接，实际 %s", expectedName, name)
	}
	if isSuper {
		t.Error("后台账号不能是超级用户：FORCE ROW LEVEL SECURITY 约束不到它")
	}
	if canBypass {
		t.Error("后台账号不能带 BYPASSRLS：那等于后台可以读任何人的任何数据")
	}
}

// 没有用户身份时，带 user_id 的表一行都读不出来。
//
// 这条比上一条更直接：就算有人忘了 WithAdminUserTx，
// 拿到的也是空结果，而不是全量数据。
func TestAdminSeesNothingWithoutUserIdentity(t *testing.T) {
	db := openAdminDB(t)

	// 挑几张最敏感的表：用户、任务、笔记、会话消息、长期记忆。
	tables := []string{"users", "tasks", "notes", "assistant_messages", "memory_items"}

	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		for _, table := range tables {
			var count int
			if err := tx.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
				return err
			}
			if count != 0 {
				t.Errorf("没有身份时 %s 读到了 %d 行，RLS 没有生效", table, count)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("查询失败：%v", err)
	}
}

// 注：「绑定用户后只看得到那个用户」这条由 platform/database/rls_test.go
// 覆盖——那里连的是 steward_app，但两个角色都是 NOBYPASSRLS，
// 走的是同一套策略。等 WithAdminUserTx 落地后再在这里补一条端到端的。

// 后台对审计表只有 INSERT 与 SELECT。
//
// 一份能被操作者自己改写或删除的审计，等于没有审计。
func TestAdminCannotMutateAuditLogs(t *testing.T) {
	db := openAdminDB(t)
	ctx := context.Background()

	for _, stmt := range []struct {
		name string
		sql  string
	}{
		{"UPDATE", "UPDATE admin.audit_logs SET reason_text = 'tampered'"},
		{"DELETE", "DELETE FROM admin.audit_logs"},
	} {
		t.Run(stmt.name, func(t *testing.T) {
			err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
				tx, err := database.TxFrom(ctx)
				if err != nil {
					return err
				}
				_, err = tx.Exec(ctx, stmt.sql)
				return err
			})
			if err == nil {
				t.Errorf("后台不该能对审计表执行 %s", stmt.name)
			}
		})
	}

	// 但 INSERT 与 SELECT 要能用，否则审计根本写不进去。
	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var count int
		return tx.QueryRow(ctx, "SELECT count(*) FROM admin.audit_logs").Scan(&count)
	})
	if err != nil {
		t.Errorf("后台应当能读审计表：%v", err)
	}
}

// 后台不能改业务数据里那些它没被授权的表。
//
// 授权是逐张给的：能改 users（暂停/恢复）与 auth_refresh_tokens（撤销会话），
// 其余一律只读。后台该能做的事是有限的几件，权限也就该是有限的几张表。
func TestAdminCannotWriteUnrelatedBusinessTables(t *testing.T) {
	db := openAdminDB(t)
	ctx := context.Background()

	for _, table := range []string{"tasks", "notes", "recipes", "memory_items", "assistant_messages"} {
		t.Run(table, func(t *testing.T) {
			err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
				tx, err := database.TxFrom(ctx)
				if err != nil {
					return err
				}
				_, err = tx.Exec(ctx, "DELETE FROM "+table)
				return err
			})
			if err == nil {
				t.Errorf("后台不该能删除 %s 的数据", table)
			}
		})
	}
}
