package auth

import (
	"sync"
	"time"
)

// LoginLimiter 按来源和账号分别限制公开认证请求，预占计数防止并发绕过。
// 当前后台为单实例；验证码发送频率和消费次数另由数据库跨进程约束。
type LoginLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket

	// 窗口内允许的失败次数。
	maxPerIP   int
	maxPerUser int
	window     time.Duration
}

type bucket struct {
	count   int
	resetAt time.Time
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

// Take 原子预占尝试次数，并发请求不能在记录失败前同时穿过限额。
func (l *LoginLimiter) Take(ip, username string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.sweep(now)
	if len(l.buckets) >= 4096 || !l.under(now, "ip:"+ip, l.maxPerIP) || !l.under(now, "user:"+username, l.maxPerUser) {
		return false
	}
	l.bump(now, "ip:"+ip)
	l.bump(now, "user:"+username)
	return true
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
