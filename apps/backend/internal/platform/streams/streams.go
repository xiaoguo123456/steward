// Package streams 在 API 与 Worker 之间传递 Turn 的实时进度。
//
// 回复在 Worker 里生成，SSE 连接却挂在 API 进程上，两者不共享内存，
// 因此需要一条跨进程的广播通道。
//
// 这条通道**不是权威状态**。它只是把已经决定好的内容更快地送到屏幕上：
//   - 丢事件不影响正确性，客户端断线后读 Message 与 Operation 就能恢复全貌。
//   - 数据库只保存最终可见文本，不为每个增量写一行。
//   - 建议只有在通过完整校验、真正落库之后才会出现在这里。
//   - 整条通道不可用时，客户端退回轮询，功能照常。
//
// 正因为它不承载权威状态，具体用什么传输是可替换的：
// 见 pgnotify 与 redisstream 两个适配器。
package streams

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// EventKind 是流事件类型。
type EventKind string

// 流事件类型取值。
const (
	// KindStatus 表示这一轮的阶段变化，例如开始运行。
	KindStatus EventKind = "status"
	// KindTool 表示正在调用某个能力。只给人看的短标签，不含参数与结果。
	KindTool EventKind = "tool"
	// KindDelta 携带「到目前为止的完整回复文本」，不是增量。
	//
	// 客户端直接替换缓冲区：这样丢事件不会造成文字缺失，中途连上来的
	// 客户端也不需要额外的补齐与去重规则。代价是重复传输，但回复通常
	// 只有几百字，且发送端已经按固定间隔节流。
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
	// Text 是 delta 的全文快照，或 status/tool 的人类可读标签。
	Text string `json:"text,omitempty"`
	// ProposalID 只在 KindProposal 出现。
	ProposalID string `json:"proposal_id,omitempty"`
	// Code 只在 KindError 出现，取契约里的稳定错误码。
	Code string `json:"code,omitempty"`
	// Truncated 为 true 表示这条快照被传输层截断过。
	//
	// 客户端据此知道屏幕上的文字还不是全部，等 done 之后读权威消息。
	Truncated bool `json:"truncated,omitempty"`
}

// Transport 是跨进程广播通道。
//
// 实现必须满足两条：Publish 失败只能记日志不能返回错误（推送失败不该让
// 整轮回复失败），Subscribe 在收到 done 或 error 后返回。
type Transport interface {
	// Name 返回传输名，写进健康检查便于排查。
	Name() string
	// Publish 推送一条事件。失败静默处理。
	Publish(ctx context.Context, turnID string, event Event)
	// Subscribe 订阅某一轮，直到收到结束事件或上下文取消。
	Subscribe(ctx context.Context, turnID string, emit func(Event) error) error
	// Close 释放资源。
	Close() error
}

// ChannelFor 返回某一轮的广播通道名。
//
// 两个适配器共用同一套命名，换传输时不需要迁移任何东西。
func ChannelFor(turnID string) string {
	return "turn_" + turnID
}

// SafeChannelName 确认通道名只含标识符字符。
//
// PostgreSQL 的 LISTEN 不接受绑定参数，通道名要拼进 SQL。
// ID 虽然由服务端生成，这里仍然自己确认一次：拼接 SQL 的地方
// 不该依赖「调用方一定传对了」。
func SafeChannelName(name string) bool {
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

// TruncateForLimit 把事件裁到传输层能承载的大小。
//
// delta 是替换语义，因此只能保留**前缀**：切成多段分别发送会让客户端
// 只显示最后一段，屏幕上就是一句从中间开始的话。保留前缀并打上
// Truncated 标记，用户看到的是「文字停在某处」，done 之后补全。
//
// limit <= 0 表示该传输没有实际上限。
func TruncateForLimit(event Event, limit int) Event {
	if limit <= 0 || len(event.Text) <= limit {
		return event
	}
	runes := []rune(event.Text)
	size := 0
	end := 0
	for end < len(runes) && size+len(string(runes[end])) <= limit {
		size += len(string(runes[end]))
		end++
	}
	event.Text = string(runes[:end])
	event.Truncated = true
	return event
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
