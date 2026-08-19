package database

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

type txContextKey struct{}

// ErrNoTransaction 表示当前上下文不在 InTx 回调内。
var ErrNoTransaction = errors.New("当前上下文没有进行中的事务")

func withTx(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, txContextKey{}, tx)
}

// TxFrom 取出当前事务句柄。
//
// 只有需要直接使用 pgx 能力的平台组件才应调用它，例如 River 的事务内入队。
// 业务模块继续使用 *dbgen.Queries，不要绕过生成代码手写 SQL。
func TxFrom(ctx context.Context) (pgx.Tx, error) {
	tx, ok := ctx.Value(txContextKey{}).(pgx.Tx)
	if !ok || tx == nil {
		return nil, ErrNoTransaction
	}
	return tx, nil
}
