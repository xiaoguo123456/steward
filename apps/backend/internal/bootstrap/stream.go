package bootstrap

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/streams"
)

// StreamPath 是 Turn 进度流的路径。
//
// 它和本地存储的传输端点属于同一类：长连接传输，生成的 strict server
// 给不出可以持续 flush 的写入口，因此手工挂载。帧结构仍然定义在契约里
// （TurnStreamEvent），客户端有稳定类型与校验器。
const StreamPath = "/v1/assistant/turns/{turn_id}/stream"

// turnStreamHandler 把一次 Turn 的进度以 SSE 推给客户端。
//
// 这条链路不承载权威状态：连不上、中途断开或事件丢失都不影响正确性，
// 客户端读 Message 与 Operation 就能恢复全貌。
func (a *App) turnStreamHandler(w http.ResponseWriter, r *http.Request) {
	userID, err := httpx.UserID(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	turnID := chi.URLParam(r, "turn_id")

	// 归属必须自己校验：这条路径不经过生成的 handler，
	// 没有别的地方会替它确认这一轮属于当前用户。
	turn, err := a.Assistant.TurnForStream(r.Context(), userID, turnID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	// 进度流整个关掉时明确拒绝，让客户端退回轮询，
	// 而不是挂着一个永远不出内容的连接。
	if a.Stream == nil {
		http.Error(w, "进度流未启用，请使用轮询", http.StatusNotImplemented)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		// 服务端没法逐段推送时明确拒绝，让客户端退回轮询，
		// 而不是挂着一个永远不出内容的连接。
		http.Error(w, "当前环境不支持流式响应", http.StatusNotImplemented)
		return
	}

	// 每个流独占一个数据库连接。名额满了就直说，客户端退回轮询。
	if !a.StreamLimiter.Acquire() {
		http.Error(w, "同时打开的流过多，请退回轮询", http.StatusServiceUnavailable)
		return
	}
	defer a.StreamLimiter.Release()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Connection", "keep-alive")
	// 反向代理的缓冲会把逐字效果攒成一次性输出。
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// 这一轮已经结束就直接收尾：客户端可能是在回复完成之后才连上来的。
	if turn.Status != "queued" && turn.Status != "running" {
		writeEvent(w, flusher, streams.Event{Kind: streams.KindDone})
		return
	}

	// 中途连上来时先补一次草稿，否则屏幕会从半句话开始出现文字。
	// delta 携带的是到目前为止的全文，客户端直接替换缓冲区，
	// 因此这次补齐和后续推送之间不会重复也不会缺字。
	if turn.DraftContent != "" {
		writeEvent(w, flusher, streams.Event{
			Kind: streams.KindDelta, Text: turn.DraftContent,
		})
	}

	ctx := r.Context()
	done := make(chan struct{})
	events := make(chan streams.Event, 32)

	go func() {
		defer close(done)
		_ = a.Stream.Subscribe(ctx, turnID, func(event streams.Event) error {
			select {
			case events <- event:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()

	heartbeat := time.NewTicker(streams.HeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			// 订阅结束（收到 done/error 或连接断开），把队列里剩下的发完。
			for {
				select {
				case event := <-events:
					writeEvent(w, flusher, event)
				default:
					return
				}
			}
		case event := <-events:
			writeEvent(w, flusher, event)
		case <-heartbeat.C:
			// 注释行，客户端会忽略；只为了让中间的代理不掐断连接。
			if _, err := w.Write([]byte(": keepalive\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeEvent(w http.ResponseWriter, flusher http.Flusher, event streams.Event) {
	frame := streams.Encode(event)
	if frame == "" {
		return
	}
	if _, err := w.Write([]byte(frame)); err != nil {
		return
	}
	flusher.Flush()
}
