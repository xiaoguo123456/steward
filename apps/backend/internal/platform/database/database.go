// Package database 提供连接池与受 RLS 约束的短事务。
//
// 所有用户数据访问都必须经过 InTx：它在事务开始时通过 set_config 写入
// app.user_id，数据库据此对每张表强制行级安全策略。即使某条 SQL 忘记写
// user_id 条件，也不会读到或改到其他用户的数据。
package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

// DB 包装连接池。
type DB struct {
	Pool *pgxpool.Pool
}

var requiredRuntimeFunctions = []string{
	"public.auth_find_user_by_phone(text)",
	"public.auth_create_user(text,text,text,text)",
	"public.auth_find_refresh_token(bytea)",
	"public.auth_rotate_refresh_token(bytea,text,bytea,timestamp with time zone)",
	"public.auth_account_is_active(text)",
	"public.admin_list_users_for_aggregation(integer,text)",
	"public.account_deletion_worker_media_keys(text)",
	"public.account_deletion_worker_purge_primary(text)",
}

// Open 建立连接池并验证可用性。
func Open(ctx context.Context, databaseURL string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("解析数据库连接串失败：%w", err)
	}
	// SSE 流每条独占一个连接（LISTEN 是连接级状态），
	// 池子必须明显大于同时允许的流数，否则长连接会把普通请求挤掉。
	// 与 bootstrap 里的 streams.NewLimiter 上限配套。
	cfg.MaxConns = 20
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("创建连接池失败：%w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("连接数据库失败：%w", err)
	}

	return &DB{Pool: pool}, nil
}

// Close 释放连接池。
func (db *DB) Close() {
	db.Pool.Close()
}

// Healthy 报告数据库当前是否可用。
func (db *DB) Healthy(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return db.Pool.Ping(ctx) == nil
}

// VerifyRuntimePrivileges 确认当前运行账号具备登录、聚合和账号删除所需的最小函数权限。
//
// 测试与生产使用独立的环境账号。迁移若 DROP/CREATE SECURITY DEFINER 函数却只给
// 本地 steward_app 授权，数据库仍然可以 Ping，但所有登录都会在运行时失败。因此
// API 与 Worker 必须在启动阶段执行本检查，让部署直接失败并回滚。
func (db *DB) VerifyRuntimePrivileges(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	rows, err := db.Pool.Query(ctx, `
		WITH required(signature) AS (
			SELECT unnest($1::text[])
		)
		SELECT required.signature
		FROM required
		LEFT JOIN pg_proc ON pg_proc.oid = to_regprocedure(required.signature)
		WHERE pg_proc.oid IS NULL
		   OR NOT has_function_privilege(current_user, pg_proc.oid, 'EXECUTE')
		ORDER BY required.signature
	`, requiredRuntimeFunctions)
	if err != nil {
		return fmt.Errorf("读取数据库运行权限失败：%w", err)
	}
	defer rows.Close()

	missing := make([]string, 0)
	for rows.Next() {
		var signature string
		if err := rows.Scan(&signature); err != nil {
			return fmt.Errorf("解析数据库运行权限失败：%w", err)
		}
		missing = append(missing, signature)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("读取数据库运行权限失败：%w", err)
	}
	if len(missing) > 0 {
		return fmt.Errorf("数据库运行账号缺少必需函数执行权限：%s", strings.Join(missing, ", "))
	}
	return nil
}

// InTx 在设置了 app.user_id 的短事务内执行 fn。
//
// 外部 Provider 调用绝不能放进这个回调：事务期间持有连接和行锁，
// 等待模型响应会迅速耗尽连接池。
func (db *DB) InTx(ctx context.Context, userID string, fn func(context.Context, *dbgen.Queries) error) error {
	if userID == "" {
		return errors.New("InTx 需要非空 userID；登录前的路径请使用 InTxAnonymous")
	}
	return db.runTx(ctx, userID, fn)
}

// InTxAnonymous 用于登录、注册和刷新令牌等尚未确定用户身份的路径。
// 这些路径只能访问不受 RLS 约束的表，或调用明确授权的 SECURITY DEFINER 函数。
func (db *DB) InTxAnonymous(ctx context.Context, fn func(context.Context, *dbgen.Queries) error) error {
	return db.runTx(ctx, "", fn)
}

func (db *DB) runTx(ctx context.Context, userID string, fn func(context.Context, *dbgen.Queries) error) error {
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("开启事务失败：%w", err)
	}
	defer func() {
		// 回滚在提交成功后是空操作，这里只兜底 panic 与提前返回。
		_ = tx.Rollback(ctx)
	}()

	if userID != "" {
		// SET LOCAL 不支持绑定参数，必须用 set_config 才能安全传值。
		// 第三个参数 true 表示 local，事务结束后自动失效。
		if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID); err != nil {
			return fmt.Errorf("设置行级安全上下文失败：%w", err)
		}
	}

	// 把事务句柄放进上下文：River 需要 pgx.Tx 才能在同一事务内入队，
	// 而业务代码只拿到 *dbgen.Queries。事务作用域本来就是上下文的属性，
	// 这样比给每个模块方法都多传一个参数更干净。
	ctx = withTx(ctx, tx)

	if err := fn(ctx, dbgen.New(tx)); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("提交事务失败：%w", err)
	}
	return nil
}

// IsNoRows 判断错误是否为“查询无结果”。
func IsNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
