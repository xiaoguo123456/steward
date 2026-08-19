// Command migrate 应用或回滚数据库迁移。
// 迁移只向前追加，不修改已经执行过的文件。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/guoxiaozheng1/steward/apps/backend/db/migrations"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/jobs"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("迁移失败：%v", err)
	}
}

func run() error {
	command := "up"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// 允许通过环境变量切到测试库执行迁移。
	if url := os.Getenv("STEWARD_MIGRATE_DATABASE_URL"); url != "" {
		cfg.DatabaseURL = url
	}

	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("连接数据库失败：%w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}

	switch command {
	case "up":
		if err := goose.Up(db, "."); err != nil {
			return err
		}
		// River 自带表结构，由它自己的迁移器维护，不混入 Goose 版本序列。
		return migrateRiver(cfg.DatabaseURL)
	case "down":
		return goose.Down(db, ".")
	case "reset":
		return goose.Reset(db, ".")
	case "status":
		return goose.Status(db, ".")
	case "version":
		return goose.Version(db, ".")
	default:
		return fmt.Errorf("未知命令 %q，可用命令：up、down、reset、status、version", command)
	}
}

// migrateRiver 应用 River 的表结构。
//
// River 用自己的迁移器管理版本，因此不写进 Goose 序列；
// 但它必须在业务迁移之后执行，以便继承 ALTER DEFAULT PRIVILEGES 授予应用角色的权限。
func migrateRiver(databaseURL string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("连接数据库失败：%w", err)
	}
	defer pool.Close()

	if err := jobs.Migrate(ctx, pool); err != nil {
		return err
	}
	log.Println("OK   River 队列表结构已就绪")
	return nil
}
