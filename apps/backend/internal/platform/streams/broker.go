// Package streams 在 API 与 Worker 之间传递 Turn 的实时进度。
//
// 回复在 Worker 里生成，SSE 连接却挂在 API 进程上，两者不共享内存。
// 这里用 PostgreSQL 的 LISTEN/NOTIFY 做通道：不额外引入 Redis 或消息队列，
// 复用已经必须可用的那个依赖。
//
// 这条通道**不是权威状态**。它只是把已经决定好的内容更快地送到屏幕上：
//   - 丢事件不影响正确性，客户端断线后读 Message 与 Operation 就能恢复全貌。
//   - 数据库只保存最终可见文本，不为每个增量写一行。
//   - 建议只有在通过完整校验、真正落库之后才会出现在这里。
package streams

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EventKind 是流事件类型。
type EventKind string

// 流事件类型取值。
const (
	// KindStatus 表示这一轮的阶段变化，例如开始运行。
	KindStatus EventKind = "status"
	// KindTool 表示正在调用某个能力。只给人看的短标签，不含参数与结果。
	KindTool EventKind = "tool"
	// KindDelta 是回复文本的增量。
	KindDelta EventKind = "delta"
	// KindProposal 表示这一轮产生了一条已经落库的建议。
	KindProposal EventKind = "proposal"
	// KindDone 表示这一轮结束，客户端应当去读权威消息。
	KindDone EventKind = "done"
	// KindError 表示这一轮失败。
	KindError EventKind = "error"
)

// Event 是一条流事件。
//
// 它只携带展示所需的最小内容：不放工具参数、不放工具结果、
// 不放模型的内部思维过程。
type Event struct {
	Kind EventKind `json:"kind"`
	// Text 用于 delta 的增量文本，或 status/tool 的人类可读标签。
	Text string `json:"text,omitempty"`
	// ProposalID 只在 KindProposal 出现。
	ProposalID string `json:"proposal_id,omitempty"`
	// Code 只在 KindError 出现，取契约里的稳定错误码。
	Code string `json:"code,omitempty"`
}

// notifyPayloadLimit 是单条 NOTIFY 的安全上限。
//
// PostgreSQL 的限制是 8000 字节；留出余量给 JSON 结构与多字节字符，
// 超过就切片发送。增量文本本来就短，正常不会走到这里。
const notifyPayloadLimit = 6000

// Publisher 由 Worker 使用，把进度推给正在监听的 API 进程。
type Publisher struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewPublisher 构造 Publisher。
func NewPublisher(pool *pgxpool.Pool, logger *slog.Logger) *Publisher {
	if logger == nil {
		logger = slog.Default()
	}
	return &Publisher{pool: pool, logger: logger}
}

// Publish 推送一条事件。
//
// 失败只记日志不返回错误：这条通道是体验增强，推送失败不能让整轮回复失败。
func (p *Publisher) Publish(ctx context.Context, turnID string, event Event) {
	if p == nil || p.pool == nil {
		return
	}
	for _, chunk := range splitText(event) {
		raw, err := json.Marshal(chunk)
		if err != nil {
			return
		}
		if _, err := p.pool.Exec(ctx, "SELECT pg_notify($1, $2)", channelFor(turnID), string(raw)); err != nil {
			p.logger.Debug("推送流事件失败，客户端会退回轮询",
				"turn_id", turnID, "error", err)
			return
		}
	}
}

// splitText 把过长的增量切成多条，保证单条 NOTIFY 不超限。
func splitText(event Event) []Event {
	if len(event.Text) <= notifyPayloadLimit {
		return []Event{event}
	}
	var out []Event
	runes := []rune(event.Text)
	for start := 0; start < len(runes); {
		end := start
		size := 0
		for end < len(runes) && size+len(string(runes[end])) <= notifyPayloadLimit {
			size += len(string(runes[end]))
			end++
		}
		part := event
		part.Text = string(runes[start:end])
		out = append(out, part)
		start = end
	}
	return out
}

// Subscriber 由 API 进程使用，订阅某一轮的进度。
type Subscriber struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewSubscriber 构造 Subscriber。
func NewSubscriber(pool *pgxpool.Pool, logger *slog.Logger) *Subscriber {
	if logger == nil {
		logger = slog.Default()
	}
	return &Subscriber{pool: pool, logger: logger}
}

// Subscribe 订阅某一轮的事件，直到收到结束事件或上下文取消。
//
// 每个订阅独占一个连接：LISTEN 是连接级状态，不能和池里的其他查询共用。
// 因此调用方必须限制同时打开的流数量。
func (s *Subscriber) Subscribe(ctx context.Context, turnID string, emit func(Event) error) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("获取监听连接失败：%w", err)
	}
	defer conn.Release()

	// 通道名不能用绑定参数，必须先确认它只由已知字符组成。
	channel := channelFor(turnID)
	if !safeChannelName(channel) {
		return fmt.Errorf("非法的流通道名")
	}
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
		var event Event
		if err := json.Unmarshal([]byte(notification.Payload), &event); err != nil {
			continue
		}
		if err := emit(event); err != nil {
			return err
		}
		if event.Kind == KindDone || event.Kind == KindError {
			return nil
		}
	}
}

func channelFor(turnID string) string {
	return "turn_" + turnID
}

// safeChannelName 确认通道名只含标识符字符。
//
// 通道名要拼进 SQL，而 ID 虽然由服务端生成，这里仍然自己确认一次：
// 拼接 SQL 的地方不该依赖"调用方一定传对了"。
func safeChannelName(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_':
		default:
			return false
		}
	}
	return true
}

// Limiter 限制同时打开的流连接数。
//
// 每个 SSE 连接独占一个数据库连接，不设上限会让连接池被长连接占满，
// 普通请求反而排不上队。
type Limiter struct {
	mu    sync.Mutex
	slots int
}

// NewLimiter 构造 Limiter。
func NewLimiter(max int) *Limiter {
	if max <= 0 {
		max = 4
	}
	return &Limiter{slots: max}
}

// Acquire 尝试占用一个名额。返回 false 表示当前流连接已满，
// 调用方应当让客户端退回轮询而不是排队等待。
func (l *Limiter) Acquire() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.slots <= 0 {
		return false
	}
	l.slots--
	return true
}

// Release 归还名额。
func (l *Limiter) Release() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.slots++
}

// HeartbeatInterval 是 SSE 心跳间隔。
//
// 中间的代理常在 60 秒无数据时断开连接；定期发注释行让连接保持活着。
const HeartbeatInterval = 20 * time.Second

// Encode 把事件编码成 SSE 帧。
func Encode(event Event) string {
	raw, err := json.Marshal(event)
	if err != nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("event: ")
	b.WriteString(string(event.Kind))
	b.WriteString("\ndata: ")
	b.Write(raw)
	b.WriteString("\n\n")
	return b.String()
}
