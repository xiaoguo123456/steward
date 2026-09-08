package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
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

// authFailure 统一公开认证接口的错误响应，不把凭据或数据库错误写入日志。
type authFailure struct {
	status int
	body   adminapi.ErrorResponse
}

func (f authFailure) write(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.status)
	return json.NewEncoder(w).Encode(f.body)
}
func (f authFailure) VisitAdminLoginResponse(w http.ResponseWriter) error { return f.write(w) }
func (f authFailure) VisitAdminRequestPhoneCodeResponse(w http.ResponseWriter) error {
	return f.write(w)
}
func (f authFailure) VisitAdminResetPasswordResponse(w http.ResponseWriter) error { return f.write(w) }

func (a *SessionAPI) preflight(ctx context.Context, phone, scope string) *authFailure {
	if len(phone) > 11 {
		return a.failure(ctx, ErrInputInvalid)
	}
	r := httpx.RequestFrom(ctx)
	if r == nil {
		return a.failure(ctx, errors.New("缺少请求上下文"))
	}
	if !a.mw.CheckLoginOrigin(r) {
		return &authFailure{http.StatusForbidden, a.errorBody(ctx, adminapi.ADMINCSRFINVALID, "来源不被允许。")}
	}
	if !a.limiter.Take(scope+ClientIP(r), scope+phone) {
		return &authFailure{http.StatusTooManyRequests, a.errorBody(ctx, adminapi.ADMINRATELIMITED, "尝试过于频繁，请稍后再试。")}
	}
	return nil
}
func (a *SessionAPI) failure(ctx context.Context, err error) *authFailure {
	status, code, message := http.StatusInternalServerError, adminapi.ADMININTERNALERROR, "服务暂时不可用，请稍后再试。"
	switch {
	case errors.Is(err, ErrInvalidLogin):
		status, code, message = 401, adminapi.ADMINLOGININVALID, "手机号或登录凭据不正确。"
	case errors.Is(err, ErrCodeInvalid):
		status, code, message = 401, adminapi.ADMINCODEINVALID, ErrCodeInvalid.Error()
	case errors.Is(err, ErrPasswordSetup):
		status, code, message = 428, adminapi.ADMINPASSWORDSETUPREQUIRED, "手机号已验证，请设置登录密码。"
	case errors.Is(err, ErrInputInvalid):
		status, code, message = 400, adminapi.ADMINVALIDATIONFAILED, ErrInputInvalid.Error()
	case errors.Is(err, ErrSMSUnavailable):
		status, code, message = 500, adminapi.ADMINSMSUNAVAILABLE, ErrSMSUnavailable.Error()
	}
	if status == 500 {
		a.logger.Error("后台认证请求失败", "request_id", httpx.RequestID(ctx), "error_type", fmt.Sprintf("%T", err))
	}
	return &authFailure{status, a.errorBody(ctx, code, message)}
}
func value(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (a *SessionAPI) AdminLogin(ctx context.Context, req adminapi.AdminLoginRequestObject) (adminapi.AdminLoginResponseObject, error) {
	if req.Body == nil {
		return a.failure(ctx, ErrInputInvalid), nil
	}
	phone := strings.TrimSpace(req.Body.Phone)
	if failed := a.preflight(ctx, phone, "auth:"); failed != nil {
		return *failed, nil
	}
	r := httpx.RequestFrom(ctx)
	token, session, err := a.svc.authenticate(ctx, loginCredentials{Phone: phone, Method: string(req.Body.Method), Password: value(req.Body.Password), ChallengeID: value(req.Body.ChallengeId), Code: value(req.Body.Code), NewPassword: value(req.Body.NewPassword)}, r.UserAgent(), HashIP(r.RemoteAddr, a.cfg.SessionSecret))
	if err != nil {
		return *a.failure(ctx, err), nil
	}
	a.logger.Info("后台登录成功", "admin_id", session.Username, "session_id", session.ID)
	return loginSuccess{body: adminapi.LoginResponse{Data: a.sessionDTO(session), Meta: a.meta(ctx)}, mw: a.mw, token: token, maxAge: int(time.Until(session.AbsoluteExpiresAt).Seconds())}, nil
}

func (a *SessionAPI) AdminRequestPhoneCode(ctx context.Context, req adminapi.AdminRequestPhoneCodeRequestObject) (adminapi.AdminRequestPhoneCodeResponseObject, error) {
	if req.Body == nil {
		return a.failure(ctx, ErrInputInvalid), nil
	}
	phone := strings.TrimSpace(req.Body.Phone)
	if failed := a.preflight(ctx, phone, "send:"); failed != nil {
		return *failed, nil
	}
	if !req.Body.ConsentAccepted {
		return a.failure(ctx, ErrInputInvalid), nil
	}
	id, err := a.svc.requestCode(ctx, phone, string(req.Body.Purpose))
	if err != nil {
		return *a.failure(ctx, err), nil
	}
	body := adminapi.PhoneCodeResponse{Meta: a.meta(ctx)}
	body.Data.ChallengeId = id
	body.Data.ExpiresInSeconds = 300
	body.Data.ResendAfterSeconds = 60
	return adminapi.AdminRequestPhoneCode200JSONResponse(body), nil
}

func (a *SessionAPI) AdminResetPassword(ctx context.Context, req adminapi.AdminResetPasswordRequestObject) (adminapi.AdminResetPasswordResponseObject, error) {
	if req.Body == nil {
		return a.failure(ctx, ErrInputInvalid), nil
	}
	phone := strings.TrimSpace(req.Body.Phone)
	if failed := a.preflight(ctx, phone, "auth:"); failed != nil {
		return *failed, nil
	}
	if err := a.svc.resetPassword(ctx, phone, req.Body.ChallengeId, req.Body.Code, req.Body.NewPassword); err != nil {
		return *a.failure(ctx, err), nil
	}
	return adminapi.AdminResetPassword200JSONResponse(adminapi.LogoutResponse{Meta: a.meta(ctx)}), nil
}

// AdminGetSession 返回当前会话。
func (a *SessionAPI) AdminGetSession(ctx context.Context,
	_ adminapi.AdminGetSessionRequestObject) (adminapi.AdminGetSessionResponseObject, error) {

	session, ok := SessionFrom(ctx)
	if !ok {
		return adminapi.AdminGetSession401JSONResponse{UnauthorizedJSONResponse: adminapi.UnauthorizedJSONResponse(a.errorBody(ctx,
			adminapi.ADMINAUTHREQUIRED, "请先登录。"))}, nil
	}
	// 仅对持有有效 Cookie 的同源请求恢复当前会话的 CSRF，供刷新页面后写操作使用。
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
		Username:          s.Username,
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
