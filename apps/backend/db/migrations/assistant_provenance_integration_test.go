package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// 在事务内构造隔离 Schema，模拟非超级用户表拥有者与默认拒绝的 FORCE RLS。
func TestAssistantProvenanceBackfillWithOwnerRLS(t *testing.T) {
	dsn := os.Getenv("STEWARD_TEST_MIGRATE_URL")
	if dsn == "" {
		t.Skip("未设置迁移验收数据库")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	schema := fmt.Sprintf("assistant_backfill_%d", time.Now().UnixNano())
	exec := func(query string) {
		t.Helper()
		if _, err := tx.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE SCHEMA " + schema + " AUTHORIZATION steward_app")
	exec("SET LOCAL ROLE steward_app")
	exec("SET LOCAL search_path TO " + schema + ", pg_catalog")
	for _, table := range []string{"tasks", "events"} {
		exec("CREATE TABLE " + table + " (id text, provenance_refs jsonb)")
		exec("INSERT INTO " + table + ` VALUES ('old', '[{"source_type":"assistant_proposal","source_id":"aprp_old","action":""},{"source_type":"capture","source_id":"cap_old","action":"derived_from"}]'), ('valid','[{"source_type":"assistant_proposal","source_id":"aprp_valid","action":"created_from"}]')`)
		exec("ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY")
		exec("ALTER TABLE " + table + " FORCE ROW LEVEL SECURITY")
	}
	raw, err := FS.ReadFile("00055_assistant_provenance_owner_backfill.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(strings.Split(string(raw), "-- +goose Down")[0])
	for _, table := range []string{"tasks", "events"} {
		var force bool
		if err := tx.QueryRowContext(ctx, "SELECT relforcerowsecurity FROM pg_class WHERE oid=$1::regclass", table).Scan(&force); err != nil {
			t.Fatal(err)
		}
		if !force {
			t.Fatalf("%s 未恢复 FORCE RLS", table)
		}
		exec("ALTER TABLE " + table + " NO FORCE ROW LEVEL SECURITY")
		var action, retained, source string
		if err := tx.QueryRowContext(ctx, "SELECT provenance_refs->0->>'action',provenance_refs->1->>'action',provenance_refs->0->>'source_id' FROM "+table+" WHERE id='old'").Scan(&action, &retained, &source); err != nil {
			t.Fatal(err)
		}
		if action != "created_from" || retained != "derived_from" || source != "aprp_old" {
			t.Fatalf("%s 回填错误：%s/%s/%s", table, action, retained, source)
		}
	}
}
