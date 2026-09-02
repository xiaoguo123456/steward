package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// TestRefreshTokenFamilyUpgradeWithExistingRows 覆盖生产式存量升级：00006 已经
// 强制启用 RLS，00050 仍必须能给旧 Refresh Token 回填 family_id。
func TestRefreshTokenFamilyUpgradeWithExistingRows(t *testing.T) {
	baseURL := os.Getenv("STEWARD_TEST_MIGRATE_URL")
	if baseURL == "" {
		t.Skip("未设置 STEWARD_TEST_MIGRATE_URL，跳过存量迁移集成测试")
	}

	parsed, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("解析测试迁移地址：%v", err)
	}
	databaseName := fmt.Sprintf("steward_upgrade_%d", time.Now().UnixNano())
	adminURL := *parsed
	adminURL.Path = "/postgres"

	adminDB, err := sql.Open("pgx", adminURL.String())
	if err != nil {
		t.Fatalf("连接测试 PostgreSQL：%v", err)
	}
	defer adminDB.Close()

	if _, err := adminDB.Exec(`CREATE DATABASE ` + databaseName); err != nil {
		t.Fatalf("创建迁移回归数据库：%v", err)
	}
	defer func() {
		if _, err := adminDB.Exec(`DROP DATABASE IF EXISTS ` + databaseName + ` WITH (FORCE)`); err != nil {
			t.Errorf("清理迁移回归数据库：%v", err)
		}
	}()

	testURL := *parsed
	testURL.Path = "/" + databaseName
	db, err := sql.Open("pgx", testURL.String())
	if err != nil {
		t.Fatalf("连接迁移回归数据库：%v", err)
	}
	defer db.Close()

	goose.SetBaseFS(FS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("设置 Goose 方言：%v", err)
	}
	if err := goose.UpTo(db, ".", 49); err != nil {
		t.Fatalf("迁移到 00049：%v", err)
	}

	const userID = "usr_upgrade_existing"
	const tokenID = "rt_upgrade_existing"
	ctx := context.Background()
	fixtureConn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("获取存量数据连接：%v", err)
	}
	if _, err := fixtureConn.ExecContext(ctx, `SELECT set_config('app.user_id', $1, false)`, userID); err != nil {
		t.Fatalf("设置测试用户上下文：%v", err)
	}
	if _, err := fixtureConn.ExecContext(ctx, `
		INSERT INTO users (id, phone, display_name)
		VALUES ($1, '13800009999', '迁移回归用户')`, userID); err != nil {
		t.Fatalf("写入存量用户：%v", err)
	}
	if _, err := fixtureConn.ExecContext(ctx, `
		INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at)
		VALUES ($1, $2, decode('01020304', 'hex'), now() + interval '1 day')`, tokenID, userID); err != nil {
		t.Fatalf("写入存量 Refresh Token：%v", err)
	}
	if err := fixtureConn.Close(); err != nil {
		t.Fatalf("释放存量数据连接：%v", err)
	}

	if err := goose.Up(db, "."); err != nil {
		t.Fatalf("从 00049 升级到最新：%v", err)
	}

	assertConn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("获取升级校验连接：%v", err)
	}
	defer assertConn.Close()
	if _, err := assertConn.ExecContext(ctx, `SELECT set_config('app.user_id', $1, false)`, userID); err != nil {
		t.Fatalf("设置升级校验用户上下文：%v", err)
	}

	var familyID string
	if err := assertConn.QueryRowContext(ctx, `SELECT family_id FROM auth_refresh_tokens WHERE id = $1`, tokenID).Scan(&familyID); err != nil {
		t.Fatalf("读取升级后的 Refresh Token：%v", err)
	}
	if familyID != tokenID {
		t.Fatalf("family_id = %q，期望回填为 %q", familyID, tokenID)
	}
}
