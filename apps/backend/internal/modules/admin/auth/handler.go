package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// SessionAPI 实现 adminapi 里与登录相关的操作。
type SessionAPI struct {
	svc     *Service
	mw      *Middleware
	limiter *LoginLimiter
	cfg     config.AdminConfig
	logger  *slog.Logger
}

// NewAPI 构造登录 SessionAPI。
func NewSessionAPI(svc *Service, mw *Middleware, limiter *LoginLimiter,
	cfg config.AdminConfig, logger *slog.Logger) *SessionAPI {
	if logger == nil {
		logger = slog.Default()
	}
	return &SessionAPI{svc: svc, mw: mw, limiter: limiter, cfg: cfg, logger: logger}
}

// loginSuccess 在写 JSON 之前把会话 Cookie 塞进去。
//
// strict server 的 handler 拿不到 ResponseWriter，但响应对象的
// Visit 方法拿得到——这是官方留的出口，不用为了写一个 Cookie
// 就把整条路由退回手工挂载。
type loginSuccess struct {
	body   adminapi.LoginResponse
	mw     *Middleware
	token  string
	maxAge int
}

func (r loginSuccess) VisitAdminLoginResponse(w http.ResponseWriter) error {
	r.mw.SetCookie(w, r.token, r.maxAge)
	return adminapi.AdminLogin200JSONResponse(r.body).VisitAdminLoginResponse(w)
}

// logoutSuccess 在写 JSON 之前清掉 Cookie。
type logoutSuccess struct {
	body adminapi.LogoutResponse
	mw   *Middleware
}

func (r logoutSuccess) VisitAdminLogoutResponse(w http.ResponseWriter) error {
	r.mw.ClearCookie(w)
	return adminapi.AdminLogout200JSONResponse(r.body).VisitAdminLogoutResponse(w)
}

// AdminLogin 处理登录。
func (a *SessionAPI) AdminLogin(ctx context.Context,
	req adminapi.AdminLoginRequestObject) (adminapi.AdminLoginResponseObject, error) {

	r := httpx.RequestFrom(ctx)
	if r == nil {
		return nil, errors.New("缺少请求上下文")
	}

	// 登录时还没有会话，但仍然要校验来源：
	// 否则任何站点都能拿着用户在别处输入的口令来打这个接口。
	if !a.mw.CheckLoginOrigin(r) {
		return adminapi.AdminLogin403JSONResponse{ForbiddenJSONResponse: adminapi.ForbiddenJSONResponse(a.errorBody(ctx,
			adminapi.ADMINCSRFINVALID, "来源不被允许。"))}, nil
	}

	ip := ClientIP(r)
	username := req.Body.Username
	if !a.limiter.Allow(ip, username) {
		return adminapi.AdminLogin429JSONResponse{RateLimitedJSONResponse: adminapi.RateLimitedJSONResponse(a.errorBody(ctx,
			adminapi.ADMINRATELIMITED, "尝试过于频繁，请稍后再试。"))}, nil
	}

	token, session, err := a.svc.Login(ctx, username, req.Body.Password,
		r.UserAgent(), HashIP(r.RemoteAddr, a.cfg.SessionSecret))
	if err != nil {
		if errors.Is(err, ErrInvalidLogin) {
			a.limiter.RecordFailure(ip, username)
			// **不区分「用户名不存在」和「口令不对」。**
			// 区分开等于告诉攻击者用户名已经猜对了。
			a.logger.Warn("后台登录失败", "ip", ip)
			return adminapi.AdminLogin401JSONResponse{UnauthorizedJSONResponse: adminapi.UnauthorizedJSONResponse(a.errorBody(ctx,
				adminapi.ADMINLOGININVALID, "用户名或口令不正确。"))}, nil
		}
		a.logger.Error("后台登录出错", "error", err)
		return adminapi.AdminLogin500JSONResponse{InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(a.errorBody(ctx,
			adminapi.ADMININTERNALERROR, "服务暂时不可用。"))}, nil
	}

	a.limiter.Reset(ip, username)
	a.logger.Info("后台登录成功", "ip", ip, "session_id", session.ID)

	return loginSuccess{
		body:  adminapi.LoginResponse{Data: a.sessionDTO(session), Meta: a.meta(ctx)},
		mw:    a.mw,
		token: token,
		// Cookie 的存活时间按绝对超时来，服务端仍然独立判断空闲超时。
		maxAge: int(time.Until(session.AbsoluteExpiresAt).Seconds()),
	}, nil
}

// AdminGetSession 返回当前会话。
func (a *SessionAPI) AdminGetSession(ctx context.Context,
	_ adminapi.AdminGetSessionRequestObject) (adminapi.AdminGetSessionResponseObject, error) {

	session, ok := SessionFrom(ctx)
	if !ok {
		return adminapi.AdminGetSession401JSONResponse{UnauthorizedJSONResponse: adminapi.UnauthorizedJSONResponse(a.errorBody(ctx,
			adminapi.ADMINAUTHREQUIRED, "请先登录。"))}, nil
	}
	// CSRF Token 只在登录那一次下发。这里重新发一个的话，
	// 任何能拿到会话的请求都能换取新的 CSRF，那这层就白加了。
	return adminapi.AdminGetSession200JSONResponse(adminapi.SessionResponse{
		Data: a.sessionDTO(session), Meta: a.meta(ctx),
	}), nil
}

// AdminLogout 撤销会话。
func (a *SessionAPI) AdminLogout(ctx context.Context,
	_ adminapi.AdminLogoutRequestObject) (adminapi.AdminLogoutResponseObject, error) {

	session, ok := SessionFrom(ctx)
	if !ok {
		return adminapi.AdminLogout401JSONResponse{UnauthorizedJSONResponse: adminapi.UnauthorizedJSONResponse(a.errorBody(ctx,
			adminapi.ADMINAUTHREQUIRED, "请先登录。"))}, nil
	}
	if err := a.svc.Logout(ctx, session.ID); err != nil {
		a.logger.Error("后台退出失败", "error", err)
		return adminapi.AdminLogout500JSONResponse{InternalErrorJSONResponse: adminapi.InternalErrorJSONResponse(a.errorBody(ctx,
			adminapi.ADMININTERNALERROR, "退出失败，请重试。"))}, nil
	}
	return logoutSuccess{body: adminapi.LogoutResponse{Meta: a.meta(ctx)}, mw: a.mw}, nil
}

func (a *SessionAPI) sessionDTO(s Session) adminapi.AdminSession {
	return adminapi.AdminSession{
		Username:          a.cfg.Username,
		CsrfToken:         s.CSRFToken,
		ExpiresAt:         s.ExpiresAt,
		AbsoluteExpiresAt: s.AbsoluteExpiresAt,
		Environment:       a.cfg.Environment,
		ReportingTimezone: a.cfg.ReportingTimezone,
	}
}

func (a *SessionAPI) meta(ctx context.Context) adminapi.ResponseMeta {
	return adminapi.ResponseMeta{RequestId: httpx.RequestID(ctx)}
}

func (a *SessionAPI) errorBody(ctx context.Context, code adminapi.ErrorCode, message string) adminapi.ErrorResponse {
	return adminapi.ErrorResponse{
		Error: adminapi.Error{Code: code, Message: message},
		Meta:  a.meta(ctx),
	}
}
