// Package pgnotify 用 PostgreSQL 的 LISTEN/NOTIFY 广播 Turn 进度。
//
// 它的好处是不引入任何新依赖：复用一个已经必须可用的组件。
// 代价有三个，都是结构性的：
//
//  1. **每条流独占一个数据库连接**。LISTEN 是连接级状态，订阅期间那个
//     连接不能做别的事。一次回复要跑几十秒，因此同时在线的流数量直接
//     从连接池里扣。
//  2. **PgBouncer 的 transaction 模式会让它彻底失效**。事务级复用意味着
//     LISTEN 注册的连接随时会被换走。
//  3. **单条 NOTIFY 载荷上限 8000 字节**。delta 是全文快照，长回复会超限。
//
// 因此它是默认实现，但不是首选：部署里有 Redis 时用 redisstream 更合适。
package pgnotify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams"
)

// payloadLimit 是单条 NOTIFY 文本的安全上限。
//
// PostgreSQL 的硬限制是 8000 字节；留出余量给 JSON 结构与多字节字符。
// 超过就截断成前缀并打标记——delta 是替换语义，切成多段会让客户端
// 只显示最后一段。
const payloadLimit = 6000

// Transport 实现 streams.Transport。
type Transport struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// New 构造 Transport。
func New(pool *pgxpool.Pool, logger *slog.Logger) *Transport {
	if logger == nil {
		logger = slog.Default()
	}
	return &Transport{pool: pool, logger: logger}
}

// Name 返回传输名。
func (t *Transport) Name() string { return "postgres" }

// Close 不持有独立资源：连接池由调用方管理。
func (t *Transport) Close() error { return nil }

// Publish 推送一条事件。
//
// 失败只记日志不返回错误：这条通道是体验增强，推送失败不能让整轮回复失败。
func (t *Transport) Publish(ctx context.Context, turnID string, event streams.Event) {
	raw, err := json.Marshal(streams.TruncateForLimit(event, payloadLimit))
	if err != nil {
		return
	}
	if _, err := t.pool.Exec(ctx, "SELECT pg_notify($1, $2)",
		streams.ChannelFor(turnID), string(raw)); err != nil {
		t.logger.Debug("推送流事件失败，客户端会退回轮询",
			"turn_id", turnID, "error", err)
	}
}

// Subscribe 订阅某一轮，直到收到结束事件或上下文取消。
//
// 每个订阅独占一个连接，调用方必须限制同时打开的流数量。
func (t *Transport) Subscribe(ctx context.Context, turnID string,
	emit func(streams.Event) error) error {

	conn, err := t.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("获取监听连接失败：%w", err)
	}
	defer conn.Release()

	channel := streams.ChannelFor(turnID)
	if !streams.SafeChannelName(channel) {
		return fmt.Errorf("非法的流通道名")
	}
	// LISTEN 不接受绑定参数，通道名只能拼进 SQL，因此上面先校验过字符集。
	if _, err := conn.Exec(ctx, `LISTEN "`+channel+`"`); err != nil {
		return fmt.Errorf("监听流通道失败：%w", err)
	}

	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			// 上下文取消是正常收尾：客户端关掉了页面。
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		var event streams.Event
		if err := json.Unmarshal([]byte(notification.Payload), &event); err != nil {
			continue
		}
		if err := emit(event); err != nil {
			return err
		}
		if event.Kind == streams.KindDone || event.Kind == streams.KindError {
			return nil
		}
	}
}
