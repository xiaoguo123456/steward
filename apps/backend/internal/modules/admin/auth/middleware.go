package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

type contextKey int

const sessionKey contextKey = iota

// WithSession 把已校验的会话放进上下文。
func WithSession(ctx context.Context, s Session) context.Context {
	return context.WithValue(ctx, sessionKey, s)
}

// SessionFrom 取出当前会话。
func SessionFrom(ctx context.Context) (Session, bool) {
	s, ok := ctx.Value(sessionKey).(Session)
	return s, ok
}

// Middleware 组装后台的鉴权链。
type Middleware struct {
	svc     *Service
	cfg     config.AdminConfig
	logger  *slog.Logger
	origins map[string]bool
}

// NewMiddleware 构造中间件。
func NewMiddleware(svc *Service, cfg config.AdminConfig, logger *slog.Logger) *Middleware {
	origins := make(map[string]bool, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		origins[strings.TrimRight(strings.TrimSpace(o), "/")] = true
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Middleware{svc: svc, cfg: cfg, logger: logger, origins: origins}
}

// 不需要会话的路径。健康探针只报告进程和数据库状态，不包含业务数据。
var publicPaths = map[string]bool{
	"/admin/v1/login":          true,
	"/admin/v1/phone-code":     true,
	"/admin/v1/password-reset": true,
	"/healthz":                 true,
}

// Authenticate 校验会话。
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if publicPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(CookieName)
		if err != nil || cookie.Value == "" {
			m.fail(w, r, http.StatusUnauthorized, adminapi.ADMINAUTHREQUIRED, "请先登录。")
			return
		}

		session, err := m.svc.Validate(r.Context(), cookie.Value)
		if err != nil {
			// 会话失效时**顺手清掉 Cookie**：留着一个已经没用的 Cookie，
			// 前端每次都要多失败一轮才知道该跳登录页。
			m.clearCookie(w)
			code := adminapi.ADMINSESSIONEXPIRED
			if err == ErrNoSession {
				code = adminapi.ADMINAUTHREQUIRED
			}
			m.fail(w, r, http.StatusUnauthorized, code, "登录状态已失效，请重新登录。")
			return
		}

		next.ServeHTTP(w, r.WithContext(WithSession(r.Context(), session)))
	})
}

// ProtectWrites 对写请求校验 Origin 与 CSRF。
//
// **两个都要，缺一不可**：
//
//   - Origin 由浏览器强制填写，脚本改不了，因此它挡得住跨站发起的请求；
//     但非浏览器客户端（curl）可以不带 Origin，所以它不能单独用。
//   - CSRF Token 需要能读到登录响应体才拿得到，跨站脚本读不到；
//     但它挡不住已经能在同源页面里执行脚本的攻击。
//
// 合起来才覆盖得住。
func (m *Middleware) ProtectWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) || publicPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		if !m.originAllowed(r) {
			m.fail(w, r, http.StatusForbidden, adminapi.ADMINCSRFINVALID, "来源不被允许。")
			return
		}

		session, ok := SessionFrom(r.Context())
		if !ok {
			m.fail(w, r, http.StatusUnauthorized, adminapi.ADMINAUTHREQUIRED, "请先登录。")
			return
		}
		if err := m.svc.VerifyCSRF(r.Context(), session.ID, r.Header.Get("X-Admin-CSRF")); err != nil {
			m.fail(w, r, http.StatusForbidden, adminapi.ADMINCSRFINVALID, "请求校验未通过，请刷新页面重试。")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// CheckLoginOrigin 单独给登录用：登录时还没有会话，但仍要校验来源。
func (m *Middleware) CheckLoginOrigin(r *http.Request) bool {
	return m.originAllowed(r)
}

// originAllowed 校验 Origin。
//
// 没有 Origin 头时**拒绝**，不放行。这是有意的：合法的浏览器写请求
// 一定带 Origin；放行「没有 Origin」等于给非浏览器客户端开了后门，
// 而后台本来就只给浏览器用。
func (m *Middleware) originAllowed(r *http.Request) bool {
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin == "" {
		// Referer 只作为兜底：有些旧浏览器在同源导航时不发 Origin。
		if ref := r.Header.Get("Referer"); ref != "" {
			if u, err := url.Parse(ref); err == nil {
				origin = strings.TrimRight(u.Scheme+"://"+u.Host, "/")
			}
		}
	}
	if origin == "" {
		return false
	}
	return m.origins[origin]
}

// PrivateCache 让后台响应永远不进缓存。
//
// 后台页面上全是跨用户的运营数据，落到任何共享缓存里都是事故。
func (m *Middleware) PrivateCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// SetCookie 写会话 Cookie。
func (m *Middleware) SetCookie(w http.ResponseWriter, token string, maxAgeSeconds int) {
	http.SetCookie(w, &http.Cookie{
		Name:  CookieName,
		Value: token,
		Path:  "/",
		// HttpOnly：JavaScript 读不到。一次 XSS 拿不走会话。
		HttpOnly: true,
		// Secure：只走 HTTPS。本地明文调试时才允许关。
		Secure: m.cfg.CookieSecure,
		// SameSite=Strict：跨站请求根本不会带上它，
		// 这是 CSRF 防线里最省事的一层。
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAgeSeconds,
	})
}

func (m *Middleware) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/",
		HttpOnly: true, Secure: m.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
}

// ClearCookie 供退出登录使用。
func (m *Middleware) ClearCookie(w http.ResponseWriter) { m.clearCookie(w) }

func (m *Middleware) fail(w http.ResponseWriter, r *http.Request, status int,
	code adminapi.ErrorCode, message string) {

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(adminapi.ErrorResponse{
		Error: adminapi.Error{Code: code, Message: message},
		Meta:  adminapi.ResponseMeta{RequestId: httpx.RequestID(r.Context())},
	})
}

func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return false
}

// HashIP 把来访 IP 压成散列后再入库。
//
// 会话表里存 IP 明文没有必要：需要它是为了「这个会话是不是换地方了」，
// 散列一样能比对，而明文是一份可以直接定位到人的记录。
func HashIP(remoteAddr, secret string) []byte {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	if host == "" {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(host))
	return mac.Sum(nil)
}

// ClientIP 取限流用的来源标识。
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
