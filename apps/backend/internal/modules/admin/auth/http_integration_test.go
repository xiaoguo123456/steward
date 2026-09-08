package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/adminapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

type sessionTestServer struct {
	adminapi.StrictServerInterface
	api *SessionAPI
}

func TestAdminClientIPTrustsOnlyPrivateProxy(t *testing.T) {
	for _, sample := range []struct{ peer, header, want string }{
		{"172.18.0.3:1234", "203.0.113.10", "203.0.113.10"},
		{"198.51.100.20:1234", "203.0.113.10", "198.51.100.20"},
		{"172.18.0.3:1234", "not-an-ip", "172.18.0.3"},
	} {
		r := httptest.NewRequest("POST", "/admin/v1/login", nil)
		r.RemoteAddr = sample.peer
		r.Header.Set("X-Real-IP", sample.header)
		if ClientIP(r) != sample.want {
			t.Fatal("代理来源判断不符合信任边界")
		}
	}
}

func (s sessionTestServer) AdminLogin(ctx context.Context, r adminapi.AdminLoginRequestObject) (adminapi.AdminLoginResponseObject, error) {
	return s.api.AdminLogin(ctx, r)
}
func (s sessionTestServer) AdminRequestPhoneCode(ctx context.Context, r adminapi.AdminRequestPhoneCodeRequestObject) (adminapi.AdminRequestPhoneCodeResponseObject, error) {
	return s.api.AdminRequestPhoneCode(ctx, r)
}
func (s sessionTestServer) AdminResetPassword(ctx context.Context, r adminapi.AdminResetPasswordRequestObject) (adminapi.AdminResetPasswordResponseObject, error) {
	return s.api.AdminResetPassword(ctx, r)
}
func (s sessionTestServer) AdminGetSession(ctx context.Context, r adminapi.AdminGetSessionRequestObject) (adminapi.AdminGetSessionResponseObject, error) {
	return s.api.AdminGetSession(ctx, r)
}
func (s sessionTestServer) AdminLogout(ctx context.Context, r adminapi.AdminLogoutRequestObject) (adminapi.AdminLogoutResponseObject, error) {
	return s.api.AdminLogout(ctx, r)
}

func TestAdminPhoneHTTPContractOriginAndCSRF(t *testing.T) {
	svc, db := phoneService(t)
	if _, err := db.Pool.Exec(context.Background(), "UPDATE admin.accounts SET password_hash=NULL WHERE phone='19900000901'"); err != nil {
		t.Fatal(err)
	}
	cfg := svc.cfg
	cfg.AllowedOrigins = []string{"http://admin.test"}
	cfg.ReportingTimezone = "Asia/Shanghai"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mw := NewMiddleware(svc, cfg, logger)
	api := NewSessionAPI(svc, mw, NewLoginLimiter(), cfg, logger)
	r := chi.NewRouter()
	r.Use(httpx.RequestIDMiddleware, httpx.RequestMiddleware, mw.PrivateCache, mw.Authenticate, mw.ProtectWrites)
	adminapi.HandlerFromMux(adminapi.NewStrictHandler(sessionTestServer{api: api}, nil), r)
	call := func(method, path string, body any, origin string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
		t.Helper()
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		req.Header.Set("X-Admin-CSRF", csrf)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		result := httptest.NewRecorder()
		r.ServeHTTP(result, req)
		return result
	}
	expectStatus := func(result *httptest.ResponseRecorder, status int) {
		t.Helper()
		if result.Code != status {
			t.Fatalf("认证接口预期状态 %d，实际 %d", status, result.Code)
		}
	}
	body := map[string]any{"phone": "19900000901", "purpose": "login", "consent_accepted": true}
	expectStatus(call("POST", "/admin/v1/phone-code", body, "", nil, ""), 403)
	expectStatus(call("POST", "/admin/v1/phone-code", body, "http://untrusted.test", nil, ""), 403)
	body["consent_accepted"] = false
	expectStatus(call("POST", "/admin/v1/phone-code", body, "http://admin.test", nil, ""), 400)
	body["consent_accepted"] = true
	sent := call("POST", "/admin/v1/phone-code", body, "http://admin.test", nil, "")
	expectStatus(sent, 200)
	if bytes.Contains(sent.Body.Bytes(), []byte("123456")) {
		t.Fatal("验证码不能从后台响应返回")
	}
	var challenge adminapi.PhoneCodeResponse
	if err := json.Unmarshal(sent.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	login := map[string]any{"phone": "19900000901", "method": "sms", "challenge_id": challenge.Data.ChallengeId, "code": "123456"}
	setup := call("POST", "/admin/v1/login", login, "http://admin.test", nil, "")
	expectStatus(setup, 428)
	if len(setup.Result().Cookies()) != 0 {
		t.Fatal("完成首次设密前不得下发会话 Cookie")
	}
	login["new_password"] = "http-fixture-password-only"
	success := call("POST", "/admin/v1/login", login, "http://admin.test", nil, "")
	expectStatus(success, 200)
	cookies := success.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("后台会话 Cookie 属性不正确")
	}
	restored := call("GET", "/admin/v1/session", nil, "http://admin.test", cookies[0], "")
	expectStatus(restored, 200)
	var session adminapi.SessionResponse
	if err := json.Unmarshal(restored.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Data.CsrfToken == "" {
		t.Fatal("刷新后必须返回可用 CSRF")
	}
	expectStatus(call("POST", "/admin/v1/logout", nil, "http://admin.test", cookies[0], "invalid"), 403)
	expectStatus(call("POST", "/admin/v1/logout", nil, "http://admin.test", cookies[0], session.Data.CsrfToken), 200)
	expectStatus(call("GET", "/admin/v1/session", nil, "http://admin.test", cookies[0], ""), 401)
}
