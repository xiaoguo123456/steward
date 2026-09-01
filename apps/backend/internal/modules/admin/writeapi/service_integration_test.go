package writeapi

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// 管理操作的集成测试。
//
// 这几条守的都是**并发与原子性**，用 mock 一条都测不出来：
// 行锁、乐观锁、幂等键、审计与业务变更同事务。

// testDB 返回两个连接。
//
// **管理操作必须以 steward_admin 身份跑**：它要写 admin.audit_logs，
// 而 steward_app 连那个 schema 都进不去——这正是隔离设计的一部分，
// 用一个连接把两件事都做了，测出来的就不是生产的行为。
//
// 造数据仍然用 steward_app：建用户与插会话是业务侧的能力，
// 后台账号没有、也不该有。
func testDB(t *testing.T) (adminDB, appDB *database.DB) {
	t.Helper()
	appDSN := config.LoadForTest().DatabaseURL
	adminDSN := config.AdminTestDatabaseURL()
	if appDSN == "" || adminDSN == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过管理操作集成测试")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	adminDB, err := database.Open(ctx, adminDSN)
	if err != nil {
		t.Fatalf("以 steward_admin 连接失败：%v", err)
	}
	t.Cleanup(adminDB.Close)

	appDB, err = database.Open(ctx, appDSN)
	if err != nil {
		t.Fatalf("以 steward_app 连接失败：%v", err)
	}
	t.Cleanup(appDB.Close)
	return adminDB, appDB
}

func seedUser(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := "198" + time.Now().Format("05.000000")[:8]

	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "管理测试", "Asia/Shanghai").Scan(&userID)
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

func actionFor(userID, key string) ActionInput {
	return ActionInput{
		UserID: userID, ExpectedVersion: 0,
		ReasonCode: "abuse_prevention", ReasonText: "集成测试用的处置理由",
		IdempotencyKey: key, RequestBody: []byte(`{"v":0}`),
		RequestID:     "req_test",
		ActorUsername: "集成测试管理员", ActorSessionID: "adms_test",
	}
}

func TestSuspendAndResume(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	suspended, err := svc.Suspend(ctx, actionFor(userID, "k-suspend-"+userID))
	if err != nil {
		t.Fatalf("暂停失败：%v", err)
	}
	if suspended.AccountStatus != "suspended" {
		t.Errorf("状态应当是 suspended，实际 %q", suspended.AccountStatus)
	}
	if suspended.Version != 1 {
		t.Errorf("版本应当推进到 1，实际 %d", suspended.Version)
	}
	if suspended.AuditLogID == "" {
		t.Error("必须返回审计 ID")
	}

	resume := actionFor(userID, "k-resume-"+userID)
	resume.ExpectedVersion = 1
	resumed, err := svc.Resume(ctx, resume)
	if err != nil {
		t.Fatalf("恢复失败：%v", err)
	}
	if resumed.AccountStatus != "active" || resumed.Version != 2 {
		t.Errorf("恢复后应当是 active/版本 2，实际 %s/%d", resumed.AccountStatus, resumed.Version)
	}
}

// 状态转换只允许一个方向。
func TestSuspendRejectsWrongCurrentStatus(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	if _, err := svc.Suspend(ctx, actionFor(userID, "k1-"+userID)); err != nil {
		t.Fatal(err)
	}
	// 已经是暂停态，再暂停要被拒。
	second := actionFor(userID, "k2-"+userID)
	second.ExpectedVersion = 1
	if _, err := svc.Suspend(ctx, second); err != ErrStatusInvalid {
		t.Errorf("重复暂停应当返回 ErrStatusInvalid，实际 %v", err)
	}
	// 反过来，active 的用户不能被「恢复」。
	other := seedUser(t, appDB)
	if _, err := svc.Resume(ctx, actionFor(other, "k3-"+other)); err != ErrStatusInvalid {
		t.Errorf("恢复一个 active 用户应当被拒，实际 %v", err)
	}
}

// 版本不对时拒绝。
//
// 两个运营看着同一个用户各点各的时，后一个必须拿到冲突，
// 而不是**悄悄覆盖掉前一个的决定**。
func TestVersionConflict(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)

	stale := actionFor(userID, "k-stale-"+userID)
	stale.ExpectedVersion = 99
	if _, err := svc.Suspend(context.Background(), stale); err != ErrVersionStale {
		t.Errorf("版本不对应当返回 ErrVersionStale，实际 %v", err)
	}
}

// **并发暂停只能成功一次。**
//
// 不加行锁的话两条 UPDATE 都会命中、版本各加一次，
// 而实际只该有一次状态转换。这条用 mock 测不出来。
func TestConcurrentSuspendOnlyOneWins(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)

	const racers = 5
	var wg sync.WaitGroup
	results := make([]error, racers)

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			// 每个用不同的幂等键，否则会被幂等挡掉而不是被锁挡掉。
			in := actionFor(userID, "k-race-"+userID+"-"+string(rune('a'+index)))
			_, results[index] = svc.Suspend(context.Background(), in)
		}(i)
	}
	wg.Wait()

	succeeded := 0
	for _, err := range results {
		if err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Errorf("并发暂停应当只成功一次，实际成功 %d 次", succeeded)
	}

	// 版本只该推进一次。
	var version int32
	err := appDB.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT status_version FROM users WHERE id = $1", userID).Scan(&version)
	})
	if err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Errorf("版本应当只推进到 1，实际 %d——说明有多次状态转换同时成功了", version)
	}
}

// 同键同请求是重放，返回上次结果且不重复执行。
func TestIdempotentReplay(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	in := actionFor(userID, "k-replay-"+userID)
	first, err := svc.Suspend(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Suspend(ctx, in)
	if err != nil {
		t.Fatalf("重放不该报错：%v", err)
	}
	if !second.Replayed {
		t.Error("第二次应当被标记为重放")
	}
	if second.Version != first.Version {
		t.Errorf("重放不该推进版本：%d → %d", first.Version, second.Version)
	}
	if second.AuditLogID != first.AuditLogID {
		t.Errorf("重放应当返回同一条审计 ID：%q vs %q", first.AuditLogID, second.AuditLogID)
	}
}

// 同键不同请求是用错了键，报冲突。
//
// 把上一次的结果发回去会让调用方以为新请求成功了——
// 而他要做的其实是另一件事。
func TestIdempotentKeyReuseIsRejected(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	in := actionFor(userID, "k-reuse-"+userID)
	if _, err := svc.Suspend(ctx, in); err != nil {
		t.Fatal(err)
	}

	different := in
	different.RequestBody = []byte(`{"v":0,"different":true}`)
	if _, err := svc.Suspend(ctx, different); err != ErrKeyReused {
		t.Errorf("同键不同请求应当返回 ErrKeyReused，实际 %v", err)
	}
}

// **业务变更与审计在同一个事务里。**
//
// 一条能被绕过的审计比没有审计更危险：它会让人以为所有操作都有记录，
// 从而在事后不再去别处查证。
func TestAuditIsWrittenWithBusinessChange(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	result, err := svc.Suspend(ctx, actionFor(userID, "k-audit-"+userID))
	if err != nil {
		t.Fatal(err)
	}

	// 审计表在 admin schema 里，steward_app 读不到——这本身就是隔离的一部分。
	// 因此这里查 user_account_actions，它引用同一个审计 ID。
	var action, auditID string
	err = appDB.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT action, audit_log_id FROM user_account_actions WHERE user_id = $1",
			userID).Scan(&action, &auditID)
	})
	if err != nil {
		t.Fatalf("管理动作记录应当存在：%v", err)
	}
	if action != "suspend" {
		t.Errorf("动作应当是 suspend，实际 %q", action)
	}
	if auditID != result.AuditLogID {
		t.Errorf("动作记录里的审计 ID 应当和返回的一致：%q vs %q", auditID, result.AuditLogID)
	}
}

// 暂停时一并撤销会话。
//
// **暂停但不踢下线等于没暂停**：他手里的令牌还能继续用到过期。
func TestSuspendRevokesSessions(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	// 造两个有效会话。
	err := appDB.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		for i := 0; i < 2; i++ {
			if _, err := tx.Exec(ctx, `
				INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at, family_id)
				VALUES ($1, $2, $3, now() + interval '30 days', $1)`,
				// 散列要唯一：固定值会让第二次运行撞上唯一约束。
				// 和成本测试踩的是同一个坑——只在干净库上能过的测试不算测试。
				idgen.New("rft"), userID, []byte(idgen.New("hash"))); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("造会话失败：%v", err)
	}

	result, err := svc.Suspend(ctx, actionFor(userID, "k-revoke-"+userID))
	if err != nil {
		t.Fatal(err)
	}
	if result.RevokedSessions != 2 {
		t.Errorf("应当撤销 2 个会话，实际 %d", result.RevokedSessions)
	}
}

// 预算是可清除的，且清除之后读不到。
func TestBudgetSetAndClear(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	userID := seedUser(t, appDB)
	ctx := context.Background()

	daily, monthly := int32(50), int32(1000)
	set, err := svc.SetBudget(ctx, BudgetInput{
		ActionInput:  actionFor(userID, "k-budget-set-"+userID),
		DailyCalls:   &daily,
		MonthlyCalls: &monthly,
	})
	if err != nil {
		t.Fatalf("设置预算失败：%v", err)
	}
	if set.Budget == nil || *set.Budget.DailyCalls != 50 {
		t.Errorf("每日预算应当是 50，实际 %+v", set.Budget)
	}

	cleared, err := svc.SetBudget(ctx, BudgetInput{
		ActionInput: actionFor(userID, "k-budget-clear-"+userID),
		Clear:       true,
	})
	if err != nil {
		t.Fatalf("清除预算失败：%v", err)
	}
	if cleared.Budget != nil {
		t.Errorf("清除后不该还有预算：%+v", cleared.Budget)
	}
}

// 用户不存在时明确报错，不是静默成功。
func TestActionOnMissingUser(t *testing.T) {
	adminDB, _ := testDB(t)
	svc := New(adminDB, nil)

	if _, err := svc.Suspend(context.Background(),
		actionFor("usr_does_not_exist", "k-missing")); err != ErrUserNotFound {
		t.Errorf("用户不存在应当返回 ErrUserNotFound，实际 %v", err)
	}
}

// 每一条审计都必须记下操作者。
//
// 审计的全部意义是可追责：记了「做了什么」却不记「谁做的」，
// 出事时只能证明「有人动过」。这条在回归里真的发现过——
// 表里从一开始就没有 actor 列，四种写操作全都追不到人。
//
// 今天后台只有一个账号，看起来「谁」没有歧义。但那不是不记的理由：
// 第二个账号加进来之前的所有历史行会永远无法归属。
func TestEveryAuditRecordsItsActor(t *testing.T) {
	adminDB, appDB := testDB(t)
	svc := New(adminDB, nil)
	ctx := context.Background()

	// 四种写操作各来一次，逐个查审计。
	type step struct {
		name string
		run  func(userID string) (string, error)
	}
	steps := []step{
		{"suspend", func(u string) (string, error) {
			r, err := svc.Suspend(ctx, actionFor(u, "k-actor-s-"+u))
			return r.AuditLogID, err
		}},
		{"resume", func(u string) (string, error) {
			if _, err := svc.Suspend(ctx, actionFor(u, "k-actor-rs-"+u)); err != nil {
				return "", err
			}
			in := actionFor(u, "k-actor-r-"+u)
			in.ExpectedVersion = 1
			r, err := svc.Resume(ctx, in)
			return r.AuditLogID, err
		}},
		{"sessions_revoke", func(u string) (string, error) {
			r, err := svc.RevokeSessions(ctx, actionFor(u, "k-actor-v-"+u))
			return r.AuditLogID, err
		}},
		{"budget_update", func(u string) (string, error) {
			daily := int32(10)
			r, err := svc.SetBudget(ctx, BudgetInput{
				ActionInput: actionFor(u, "k-actor-b-"+u), DailyCalls: &daily,
			})
			return r.AuditLogID, err
		}},
	}

	for _, st := range steps {
		t.Run(st.name, func(t *testing.T) {
			userID := seedUser(t, appDB)
			auditID, err := st.run(userID)
			if err != nil {
				t.Fatalf("%s 失败：%v", st.name, err)
			}
			if auditID == "" {
				t.Fatalf("%s 没有写审计", st.name)
			}

			var actor string
			var sessionID *string
			err = adminDB.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
				tx, err := database.TxFrom(ctx)
				if err != nil {
					return err
				}
				return tx.QueryRow(ctx,
					"SELECT actor_username, actor_session_id FROM admin.audit_logs WHERE id = $1",
					auditID).Scan(&actor, &sessionID)
			})
			if err != nil {
				t.Fatalf("读审计失败：%v", err)
			}
			if actor == "" {
				t.Errorf("%s 的审计没有记下操作者", st.name)
			}
			if sessionID == nil || *sessionID == "" {
				t.Errorf("%s 的审计没有记下会话 ID", st.name)
			}
		})
	}
}
