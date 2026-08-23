package database_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 行级安全的集成测试。
//
// 这些用例守的是整个系统最不能出错的一条边界：一个用户永远看不到、
// 也改不到另一个用户的数据。它靠三件事共同成立，缺一条就全线失效：
//
//  1. 每张用户表都 ENABLE + FORCE ROW LEVEL SECURITY。
//  2. 应用连接用的是 NOSUPERUSER NOBYPASSRLS 的 steward_app 角色——
//     超级用户或 BYPASSRLS 角色不受策略约束，用它们连接会让所有隔离形同虚设。
//  3. 每个事务开始时用 set_config 写入 app.user_id。
//
// 因此这里不 mock 任何东西：必须连真实数据库、用真实角色跑。

// openTestDB 连接测试库。没有配置时跳过，不让本地开发被迫准备一套库。
func openTestDB(t *testing.T) *database.DB {
	t.Helper()
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过行级安全测试")
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

// seedUser 创建一个用户和一条属于他的任务，返回两者的 ID。
//
// 用户表本身也受 RLS 约束，因此创建用户要走 SECURITY DEFINER 函数，
// 与登录路径完全一致。
func seedUser(t *testing.T, db *database.DB, phone string) (userID, taskID string) {
	t.Helper()
	ctx := context.Background()

	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// auth_create_user 是 RETURNS TABLE，必须走 FROM 才能按列取值，
		// 直接 SELECT 函数名拿到的是一整个 record。
		return tx.QueryRow(ctx,
			`SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			idgen.New(idgen.PrefixUser), phone, "测试用户", "Asia/Shanghai",
		).Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		list, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID,
			Name: "默认清单", Position: 0, IsDefault: true, ListKind: "tasks",
		})
		if err != nil {
			return err
		}
		task, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
			ID: idgen.New(idgen.PrefixTask), UserID: userID,
			Title: "只有我能看见", Status: "todo", Priority: "normal",
			ListID: list.ID, Reminders: []byte("[]"),
			CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		})
		if err != nil {
			return err
		}
		taskID = task.ID
		return nil
	})
	if err != nil {
		t.Fatalf("写入测试任务失败：%v", err)
	}
	return userID, taskID
}

// phoneCounter 保证同一次测试运行内的手机号互不相同。
var phoneCounter atomic.Int64

// uniquePhone 造一个不会撞的手机号。
//
// 手机号有唯一约束。不能取 ID 的前几位——那是 UUIDv7 的时间前缀，
// 连续调用完全一样；随机部分在尾部。再加一个计数器兜底。
func uniquePhone() string {
	id := idgen.New("t")
	tail := id[len(id)-6:]
	return fmt.Sprintf("1%02d%s", phoneCounter.Add(1)%100, tail)
}

// 甲读不到乙的任务。这是最基本的一条。
func TestRLSBlocksCrossUserRead(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	_, aliceTask := seedUser(t, db, uniquePhone())
	bob, _ := seedUser(t, db, uniquePhone())

	err := db.InTx(ctx, bob, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetTask(ctx, aliceTask); err != nil {
			if database.IsNoRows(err) {
				return nil // 期望：查不到。
			}
			return err
		}
		t.Error("乙读到了甲的任务")
		return nil
	})
	if err != nil {
		t.Fatalf("查询出错：%v", err)
	}
}

// 甲的任务不出现在乙的列表里。
//
// 单条查询被挡住不代表列表也被挡住：漏写 user_id 条件的地方
// 通常是在列表查询上。
func TestRLSBlocksCrossUserList(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	seedUser(t, db, uniquePhone())
	bob, bobTask := seedUser(t, db, uniquePhone())

	err := db.InTx(ctx, bob, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses: []string{"todo", "doing", "done"}, RowLimit: 100,
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			if row.ID != bobTask {
				t.Errorf("乙的列表里出现了别人的任务：%s", row.ID)
			}
		}
		if len(rows) != 1 {
			t.Errorf("乙应当只看到自己的 1 条任务，实际 %d 条", len(rows))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("查询出错：%v", err)
	}
}

// 甲改不动乙的任务：UPDATE 影响 0 行，而不是悄悄改掉。
func TestRLSBlocksCrossUserUpdate(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	alice, aliceTask := seedUser(t, db, uniquePhone())
	bob, _ := seedUser(t, db, uniquePhone())

	err := db.InTx(ctx, bob, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			`UPDATE tasks SET title = '被别人改了' WHERE id = $1`, aliceTask)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Errorf("乙改动了甲的任务，影响 %d 行", tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		t.Fatalf("更新出错：%v", err)
	}

	// 再从甲的视角确认标题没变。
	err = db.InTx(ctx, alice, func(ctx context.Context, q *dbgen.Queries) error {
		task, err := q.GetTask(ctx, aliceTask)
		if err != nil {
			return err
		}
		if task.Title != "只有我能看见" {
			t.Errorf("标题被改成了 %q", task.Title)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("复查出错：%v", err)
	}
}

// 甲删不掉乙的任务。
func TestRLSBlocksCrossUserDelete(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	alice, aliceTask := seedUser(t, db, uniquePhone())
	bob, _ := seedUser(t, db, uniquePhone())

	err := db.InTx(ctx, bob, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, aliceTask)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Errorf("乙删掉了甲的任务，影响 %d 行", tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		t.Fatalf("删除出错：%v", err)
	}

	err = db.InTx(ctx, alice, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetTask(ctx, aliceTask); err != nil {
			t.Errorf("甲的任务不见了：%v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("复查出错：%v", err)
	}
}

// 冒充别人的 user_id 也没用：写入时 user_id 被策略强制成当前身份。
//
// 这一条防的是「服务端某处把请求里的 user_id 直接透传下去」这类错误。
func TestRLSRejectsForgedOwner(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	alice, _ := seedUser(t, db, uniquePhone())
	bob, bobTask := seedUser(t, db, uniquePhone())

	err := db.InTx(ctx, bob, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// 乙试图把自己的任务改挂到甲名下。
		_, err = tx.Exec(ctx, `UPDATE tasks SET user_id = $1 WHERE id = $2`, alice, bobTask)
		if err == nil {
			t.Error("乙成功把任务改挂到了甲名下")
		}
		return nil
	})
	// 违反 WITH CHECK 会让整个事务出错，这里的错误是预期结果。
	if err == nil {
		t.Log("提示：改写 user_id 未报错，请确认策略带了 WITH CHECK")
	}
}

// 没有设置 app.user_id 时什么都看不到。
//
// 这是兜底：万一某条路径忘了走 InTx，它应当读到空，而不是读到全部。
func TestRLSHidesEverythingWithoutIdentity(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	seedUser(t, db, uniquePhone())

	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM tasks`).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Errorf("没有身份时读到了 %d 条任务", count)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("查询出错：%v", err)
	}
}

// 应用角色不能绕过 RLS。
//
// 这一条守的是部署配置：把连接串换成超级用户会让上面所有用例
// 同时失效，而且不会有任何报错。
func TestAppRoleCannotBypassRLS(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var superuser, bypassRLS bool
		if err := tx.QueryRow(ctx,
			`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
		).Scan(&superuser, &bypassRLS); err != nil {
			return err
		}
		if superuser {
			t.Error("应用连接用的是超级用户，FORCE ROW LEVEL SECURITY 对它无效")
		}
		if bypassRLS {
			t.Error("应用角色带 BYPASSRLS，所有隔离策略都会失效")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("查询角色属性出错：%v", err)
	}
}

// 每张用户表都必须同时 ENABLE 和 FORCE。
//
// 新增一张表却忘了加策略，是这类系统最常见的漏洞来源；
// 这条用例让它在 CI 里就暴露，而不是等到线上。
func TestAllUserTablesForceRLS(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	// 不属于任何用户的表：平台内容与框架自己的表。
	shared := map[string]bool{
		"recipes":          true,
		"goose_db_version": true,
	}
	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN information_schema.columns col
			     ON col.table_name = c.relname AND col.table_schema = n.nspname
			WHERE n.nspname = 'public' AND c.relkind = 'r' AND col.column_name = 'user_id'
		`)
		if err != nil {
			return err
		}
		defer rows.Close()

		checked := 0
		for rows.Next() {
			var name string
			var enabled, forced bool
			if err := rows.Scan(&name, &enabled, &forced); err != nil {
				return err
			}
			if shared[name] {
				continue
			}
			checked++
			if !enabled {
				t.Errorf("表 %s 有 user_id 却没有 ENABLE ROW LEVEL SECURITY", name)
			}
			if !forced {
				t.Errorf("表 %s 没有 FORCE ROW LEVEL SECURITY，表属主可以绕过", name)
			}
		}
		if checked == 0 {
			t.Fatal("一张带 user_id 的表都没检查到，测试库可能没有迁移")
		}
		t.Logf("检查了 %d 张用户表", checked)
		return rows.Err()
	})
	if err != nil {
		t.Fatalf("检查表属性出错：%v", err)
	}
}

// users 没有 user_id 列，不在上面的自动扫描中。登录前函数所需的额外策略
// 必须保留 FORCE，只在 SECURITY DEFINER 切换身份时生效。
func TestSecurityDefinerPoliciesStayNarrow(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	err := db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT relname, relrowsecurity, relforcerowsecurity
			FROM pg_class
			WHERE oid IN ('users'::regclass, 'auth_refresh_tokens'::regclass)
			ORDER BY relname
		`)
		if err != nil {
			return err
		}
		defer rows.Close()

		checked := 0
		for rows.Next() {
			var name string
			var enabled, forced bool
			if err := rows.Scan(&name, &enabled, &forced); err != nil {
				return err
			}
			checked++
			if !enabled {
				t.Errorf("表 %s 必须 ENABLE ROW LEVEL SECURITY", name)
			}
			if !forced {
				t.Errorf("表 %s 必须 FORCE ROW LEVEL SECURITY", name)
			}
		}
		if checked != 2 {
			t.Fatalf("应检查 2 张 SECURITY DEFINER 表，实际 %d", checked)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		for _, table := range []string{"users", "auth_refresh_tokens"} {
			var count int
			query := fmt.Sprintf("SELECT count(*) FROM %s", table)
			if err := tx.QueryRow(ctx, query).Scan(&count); err != nil {
				return err
			}
			if count != 0 {
				t.Errorf("匿名应用账号从表 %s 读到了 %d 行", table, count)
			}
		}

		var selectPolicies int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_policies
			WHERE schemaname = 'public'
			  AND policyname IN (
			      'users_auth_definer_select',
			      'refresh_tokens_auth_definer_select'
			  )
			  AND qual = '(CURRENT_USER <> SESSION_USER)'
		`).Scan(&selectPolicies); err != nil {
			return err
		}
		if selectPolicies != 2 {
			t.Errorf("应有 2 条受限的登录前读取策略，实际 %d", selectPolicies)
		}

		var insertPolicies int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_policies
			WHERE schemaname = 'public'
			  AND policyname = 'users_auth_definer_insert'
			  AND with_check = '(CURRENT_USER <> SESSION_USER)'
		`).Scan(&insertPolicies); err != nil {
			return err
		}
		if insertPolicies != 1 {
			t.Errorf("应有 1 条受限的用户创建策略，实际 %d", insertPolicies)
		}

		var publicExecute int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_proc p,
			     aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
			WHERE p.proname IN (
			    'auth_find_user_by_phone',
			    'auth_create_user',
			    'auth_find_refresh_token'
			)
			  AND acl.grantee = 0
			  AND acl.privilege_type = 'EXECUTE'
		`).Scan(&publicExecute); err != nil {
			return err
		}
		if publicExecute != 0 {
			t.Errorf("登录前 SECURITY DEFINER 函数仍有 %d 条 PUBLIC 执行授权", publicExecute)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("检查 SECURITY DEFINER 表失败：%v", err)
	}
}

// 甲的本周菜单不会出现在乙那里。
//
// 菜单是「按周查」而不是按 ID 查的，所以它不像单条读取那样天然带归属条件：
// 万一策略漏了，乙查自己这一周会直接查出甲的那份，而且看不出异常。
func TestRLSIsolatesMealPlans(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	alice, _ := seedUser(t, db, uniquePhone())
	bob, _ := seedUser(t, db, uniquePhone())
	weekStart := time.Date(2026, 8, 17, 0, 0, 0, 0, time.UTC)

	err := db.InTx(ctx, alice, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.UpsertMealPlan(ctx, dbgen.UpsertMealPlanParams{
			ID: idgen.New(idgen.PrefixMealPlan), UserID: alice, WeekStart: weekStart,
		})
		return err
	})
	if err != nil {
		t.Fatalf("甲创建菜单失败：%v", err)
	}

	err = db.InTx(ctx, bob, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetMealPlanByWeek(ctx, weekStart); err != nil {
			if database.IsNoRows(err) {
				return nil // 期望：同一周，乙查不到甲的那份。
			}
			return err
		}
		t.Error("乙查到了甲的本周菜单")
		return nil
	})
	if err != nil {
		t.Fatalf("查询出错：%v", err)
	}
}

// 甲的饮食档案不会被乙读到。
//
// 这张表用主键做隔离而不是单独的 user_id 列，策略写法和别的表不一样，
// 值得单独守一条——里面装的是身体数据。
func TestRLSIsolatesDietProfile(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	alice, _ := seedUser(t, db, uniquePhone())
	bob, _ := seedUser(t, db, uniquePhone())

	goal := "muscle_gain"
	err := db.InTx(ctx, alice, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.UpsertDietProfile(ctx, dbgen.UpsertDietProfileParams{
			UserID: alice, Goal: &goal,
		})
		return err
	})
	if err != nil {
		t.Fatalf("甲写入档案失败：%v", err)
	}

	err = db.InTx(ctx, bob, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetDietProfile(ctx, alice); err != nil {
			if database.IsNoRows(err) {
				return nil // 期望：拿着甲的 user_id 也读不到。
			}
			return err
		}
		t.Error("乙读到了甲的饮食档案")
		return nil
	})
	if err != nil {
		t.Fatalf("查询出错：%v", err)
	}
}
