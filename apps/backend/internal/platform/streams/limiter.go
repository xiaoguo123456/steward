package streams

import "sync"

// Limiter 限制同时打开的流连接数。
//
// 上限该设多少完全取决于传输：
//   - pgnotify 每条流独占一个数据库连接（LISTEN 是连接级状态），
//     因此上限必须明显小于连接池，否则长连接会把池占满，
//     普通请求排不上队。
//   - redisstream 的订阅连接很便宜，上限可以高一到两个数量级。
//
// 达到上限时直接拒绝而不是排队：让客户端立刻退回轮询，
// 好过挂在一个迟迟不出内容的连接上。
type Limiter struct {
	mu    sync.Mutex
	slots int
	max   int
}

// NewLimiter 构造 Limiter。
func NewLimiter(max int) *Limiter {
	if max <= 0 {
		max = 4
	}
	return &Limiter{slots: max, max: max}
}

// Acquire 尝试占用一个名额。返回 false 表示当前流连接已满。
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
	if l.slots < l.max {
		l.slots++
	}
}

// Max 返回上限，用于健康检查展示。
func (l *Limiter) Max() int { return l.max }
