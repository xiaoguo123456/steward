package auth

import (
	"sync"
	"time"
)

// LoginLimiter 是登录限流。
//
// 按 IP 与用户名**分别**计数，两个口径任一超限都拒绝：
//
//   - 只按 IP：攻击者换代理就绕过了。
//   - 只按用户名：一个人猜错几次会把真正的管理员锁在门外，
//     而后台只有一个账号，这等于把自己关在外面。
//
// 两个一起看，才既挡得住分布式爆破，又不至于让正主进不来——
// 后者会退到按 IP 的额度，而攻击者用别的 IP 时会撞上用户名额度。
//
// 用进程内计数而不是 Redis：后台是单实例、低流量的进程，
// 为它引入一个跨进程依赖不划算。真要多实例了再说。
type LoginLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket

	// 窗口内允许的失败次数。
	maxPerIP   int
	maxPerUser int
	window     time.Duration
}

type bucket struct {
	count     int
	resetAt   time.Time
	blockedAt time.Time
}

// NewLoginLimiter 构造限流器。
func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{
		buckets: map[string]*bucket{},
		// 正常人不会在五分钟里连错十次；而爆破在这个额度下毫无意义。
		maxPerIP:   10,
		maxPerUser: 20,
		window:     5 * time.Minute,
	}
}

// Allow 判断这次登录尝试能不能放行。
func (l *LoginLimiter) Allow(ip, username string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.sweep(now)
	return l.under(now, "ip:"+ip, l.maxPerIP) && l.under(now, "user:"+username, l.maxPerUser)
}

// RecordFailure 记一次失败。**只记失败，不记成功**：
// 正常使用不该消耗额度，否则一个用得勤的管理员会被自己限住。
func (l *LoginLimiter) RecordFailure(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.bump(now, "ip:"+ip)
	l.bump(now, "user:"+username)
}

// Reset 在登录成功后清掉这两个计数。
func (l *LoginLimiter) Reset(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.buckets, "ip:"+ip)
	delete(l.buckets, "user:"+username)
}

func (l *LoginLimiter) under(now time.Time, key string, max int) bool {
	b, ok := l.buckets[key]
	if !ok || now.After(b.resetAt) {
		return true
	}
	return b.count < max
}

func (l *LoginLimiter) bump(now time.Time, key string) {
	b, ok := l.buckets[key]
	if !ok || now.After(b.resetAt) {
		l.buckets[key] = &bucket{count: 1, resetAt: now.Add(l.window)}
		return
	}
	b.count++
}

// sweep 清掉过期的桶，避免 map 无限长大。
//
// 不另开 goroutine：这个 map 只在登录时被访问，顺手清理就够了，
// 一个常驻的清理协程反而多一份要维护的生命周期。
func (l *LoginLimiter) sweep(now time.Time) {
	if len(l.buckets) < 1024 {
		return
	}
	for key, b := range l.buckets {
		if now.After(b.resetAt) {
			delete(l.buckets, key)
		}
	}
}
