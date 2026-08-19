// Package redisstream 用 Redis Pub/Sub 广播 Turn 进度。
//
// 相比 pgnotify，它解决三个结构性问题：
//
//  1. 订阅不再占用数据库连接。Redis 的连接很便宜，同时在线的流数量
//     不再从连接池里扣。
//  2. 不受 PgBouncer transaction 模式影响。
//  3. 没有 8000 字节载荷上限，长回复的全文快照可以整条发出去。
//
// 但它仍然只是传输：Redis 不可用时整条链路退回轮询，功能照常。
// 因此这里没有重连退避、没有持久化、没有 ACK ——
// Pub/Sub 的「订阅者不在就丢弃」正是我们要的语义。
//
// 有意不用 Redis Stream：那是持久化队列，会引入消费位点与清理策略，
// 而进度事件过期即无用，多存一份只是负担。
package redisstream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams"
)

// Transport 实现 streams.Transport。
type Transport struct {
	client *redis.Client
	logger *slog.Logger
}

// New 连接 Redis 并构造 Transport。
//
// 连不上时直接返回错误：配置了 Redis 却连不上是部署问题，
// 应当在启动时就暴露，而不是等到用户点开对话才发现没有流。
func New(ctx context.Context, url string, logger *slog.Logger) (*Transport, error) {
	if logger == nil {
		logger = slog.Default()
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("解析 Redis 地址失败：%w", err)
	}
	// 进度推送是旁路：连接与读写都不该拖住主流程。
	options.DialTimeout = 3 * time.Second
	options.ReadTimeout = 3 * time.Second
	options.WriteTimeout = 3 * time.Second

	client := redis.NewClient(options)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("连接 Redis 失败：%w", err)
	}
	return &Transport{client: client, logger: logger}, nil
}

// Name 返回传输名。
func (t *Transport) Name() string { return "redis" }

// Close 关闭客户端。
func (t *Transport) Close() error { return t.client.Close() }

// Publish 推送一条事件。
//
// 失败只记日志不返回错误：这条通道是体验增强，推送失败不能让整轮回复失败。
func (t *Transport) Publish(ctx context.Context, turnID string, event streams.Event) {
	raw, err := json.Marshal(event)
	if err != nil {
		return
	}
	if err := t.client.Publish(ctx, streams.ChannelFor(turnID), raw).Err(); err != nil {
		t.logger.Debug("推送流事件失败，客户端会退回轮询",
			"turn_id", turnID, "error", err)
	}
}

// Subscribe 订阅某一轮，直到收到结束事件或上下文取消。
func (t *Transport) Subscribe(ctx context.Context, turnID string,
	emit func(streams.Event) error) error {

	sub := t.client.Subscribe(ctx, streams.ChannelFor(turnID))
	defer func() { _ = sub.Close() }()

	// 等订阅真正建立再返回：否则调用方以为已经在听，
	// 而这期间发出的事件会被丢掉。
	if _, err := sub.Receive(ctx); err != nil {
		return fmt.Errorf("订阅流通道失败：%w", err)
	}

	channel := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			// 上下文取消是正常收尾：客户端关掉了页面。
			return nil
		case message, ok := <-channel:
			if !ok {
				return nil
			}
			var event streams.Event
			if err := json.Unmarshal([]byte(message.Payload), &event); err != nil {
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
}
